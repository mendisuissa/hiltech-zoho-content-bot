import { Router, type NextFunction, type Request, type Response } from 'express';
import { prisma } from '../db/prisma';
import { sendApprovedContentPack, sendApprovalNotification } from '../services/telegramService';
import { logger } from '../utils/logger';
import { regeneratePendingApproval } from '../services/regenerationService';

export const approvalsRouter = Router();

function getSingleRouteId(routeId: string | string[] | undefined): string | undefined {
  return typeof routeId === 'string' && routeId.trim().length > 0 ? routeId : undefined;
}

function approvalTokenFromRequest(req: Pick<Request, 'header' | 'body' | 'query'>): string | undefined {
  const headerToken = req.header('x-approval-token');
  if (headerToken) return headerToken;
  if (typeof req.body === 'object' && req.body !== null && 'token' in req.body) {
    const token = (req.body as { token?: unknown }).token;
    if (typeof token === 'string') return token;
  }
  return typeof req.query?.token === 'string' ? req.query.token : undefined;
}

async function loadPendingApproval(id: string) {
  return prisma.approvalRequest.findFirst({ where: { id, status: 'pending' }, include: { sourceItem: { include: { sourceConfig: true } } } });
}

approvalsRouter.get('/pending', async (_req, res, next) => {
  try {
    const pending = await prisma.approvalRequest.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'desc' }, include: { sourceItem: { include: { sourceConfig: true } } } });
    return res.json({ ok: true, items: pending.map((item) => ({ ...item, approvePath: `/api/approvals/${item.id}/approve?token=${item.approvalToken}`, rejectPath: `/api/approvals/${item.id}/reject?token=${item.approvalToken}` })) });
  } catch (error) { return next(error); }
});

/**
 * Re-sends pending approval cards to the configured Telegram management chat.
 * Useful after a deploy that adds Telegram buttons or changes formatting.
 * Protected with the same x-scan-secret used by the scan endpoint.
 */
approvalsRouter.post('/resend-pending', async (req, res, next) => {
  try {
    const scanSecret = req.header('x-scan-secret');
    if (!scanSecret || scanSecret !== process.env.SCAN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 12;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 25) : 12;

    const pending = await prisma.approvalRequest.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { sourceItem: true },
    });

    let sent = 0;
    const failures: Array<{ approvalId: string; error: string }> = [];
    for (const approval of pending) {
      try {
        await sendApprovalNotification(approval, approval.sourceItem);
        sent += 1;
      } catch (error) {
        failures.push({
          approvalId: approval.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('Pending Telegram approvals resent', { requested: pending.length, sent, failures: failures.length });
    return res.json({ ok: true, requested: pending.length, sent, failures });
  } catch (error) {
    return next(error);
  }
});

approvalsRouter.post('/:id/regenerate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const approvalId = getSingleRouteId(req.params.id);
    if (!approvalId) return res.status(400).json({ error: 'Invalid approval id' });
    const scanSecret = req.header('x-scan-secret');
    if (scanSecret !== process.env.SCAN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    const regenerated = await regeneratePendingApproval(approvalId);
    if (!regenerated) return res.status(404).json({ error: 'Pending approval not found' });
    await sendApprovalNotification(regenerated, regenerated.sourceItem);
    return res.json({ ok: true, approvalId: regenerated.id, qualityStatus: regenerated.qualityStatus, qualityScore: regenerated.qualityScore });
  } catch (error) { return next(error); }
});

async function approveRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const approvalId = getSingleRouteId(req.params.id);
    if (!approvalId) return res.status(400).json({ error: 'Invalid approval id' });
    const approval = await loadPendingApproval(approvalId);
    if (!approval) return res.status(404).json({ error: 'Pending approval not found' });
    if (approvalTokenFromRequest(req) !== approval.approvalToken) return res.status(401).json({ error: 'Invalid approval token' });
    const updated = await prisma.approvalRequest.update({ where: { id: approval.id }, data: { status: 'approved', approvedAt: new Date() } });
    await sendApprovedContentPack(updated);
    logger.info('Approval approved and content delivered to Telegram', { approvalId: approval.id });
    return res.json({ ok: true, approval: updated, delivery: 'telegram' });
  } catch (error) { return next(error); }
}

async function rejectRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const approvalId = getSingleRouteId(req.params.id);
    if (!approvalId) return res.status(400).json({ error: 'Invalid approval id' });
    const approval = await loadPendingApproval(approvalId);
    if (!approval) return res.status(404).json({ error: 'Pending approval not found' });
    if (approvalTokenFromRequest(req) !== approval.approvalToken) return res.status(401).json({ error: 'Invalid approval token' });
    const reason = typeof req.body === 'object' && req.body !== null && 'reason' in req.body ? String((req.body as { reason?: unknown }).reason ?? 'Rejected by operator') : 'Rejected by operator';
    const updated = await prisma.approvalRequest.update({ where: { id: approval.id }, data: { status: 'rejected', rejectedAt: new Date(), rejectionReason: reason } });
    logger.info('Approval rejected', { approvalId: approval.id });
    return res.json({ ok: true, approval: updated });
  } catch (error) { return next(error); }
}

approvalsRouter.get('/:id/approve', approveRequest);
approvalsRouter.post('/:id/approve', approveRequest);
approvalsRouter.get('/:id/reject', rejectRequest);
approvalsRouter.post('/:id/reject', rejectRequest);
