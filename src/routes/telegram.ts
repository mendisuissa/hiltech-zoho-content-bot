import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import {
  acknowledgeTelegramCallback,
  isConfiguredApprovalChat,
  markTelegramApprovalMessage,
  sendApprovedContentPack,
  sendApprovalPreview,
  sendDetailedApprovalPreview,
  generateAndSendCoverImage,
  type TelegramCallbackQuery,
} from '../services/telegramService';
import { logger } from '../utils/logger';
import { regeneratePendingApproval } from '../services/regenerationService';

type TelegramUpdate = { callback_query?: TelegramCallbackQuery };

export const telegramRouter = Router();

function verifyTelegramWebhook(req: Request): boolean {
  if (!env.TELEGRAM_WEBHOOK_SECRET) return true;
  return req.header('x-telegram-bot-api-secret-token') === env.TELEGRAM_WEBHOOK_SECRET;
}

async function getPendingApproval(id: string) {
  return prisma.approvalRequest.findFirst({ where: { id, status: 'pending' } });
}

async function processTelegramCallback(update: TelegramUpdate): Promise<void> {
  const callback = update.callback_query;
  if (!callback?.data || !callback.message) return;

  if (!isConfiguredApprovalChat(callback.message.chat.id)) {
    try { await acknowledgeTelegramCallback(callback.id, 'הפעולה מותרת רק בקבוצת ניהול HilTech.'); } catch (error) {
      logger.warn('Telegram callback acknowledgement failed', { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const [action, approvalId] = callback.data.split(':', 2);
  if (!approvalId || !['preview', 'approve', 'reject', 'cover', 'regenerate'].includes(action)) {
    try { await acknowledgeTelegramCallback(callback.id, 'פעולה לא תקינה.'); } catch (error) {
      logger.warn('Telegram callback acknowledgement failed', { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  // Acknowledge immediately. Telegram expects a webhook response quickly, while
  // preview/regeneration can take longer because it may call OpenAI.
  try {
    await acknowledgeTelegramCallback(callback.id, action === 'regenerate' ? 'הכתיבה מחדש התחילה…' : 'הפעולה התקבלה…');
  } catch (error) {
    // A stale/retried callback can no longer be acknowledged. Do not fail the work.
    logger.warn('Telegram callback acknowledgement failed', { approvalId, action, error: error instanceof Error ? error.message : String(error) });
  }

  const approval = await getPendingApproval(approvalId);
  if (!approval) {
    await sendApprovalPreviewMessageUnavailable(callback.message.chat.id, 'הפריט כבר טופל או אינו זמין.');
    return;
  }

  if (action === 'preview') {
    await sendDetailedApprovalPreview(approval);
    return;
  }

  if (action === 'cover') {
    await generateAndSendCoverImage(approval);
    return;
  }

  if (action === 'regenerate') {
    const regenerated = await regeneratePendingApproval(approval.id);
    if (!regenerated) {
      await sendApprovalPreviewMessageUnavailable(callback.message.chat.id, 'הפריט כבר אינו זמין לכתיבה מחדש.');
      return;
    }
    await sendApprovalPreview(regenerated);
    logger.info('Telegram approval regenerated', { approvalId: approval.id });
    return;
  }

  if (action === 'approve') {
    const updated = await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: { status: 'approved', approvedAt: new Date() },
    });
    await sendApprovedContentPack(updated);
    await markTelegramApprovalMessage(updated, 'approved', callback);
    logger.info('Telegram approval completed', { approvalId: approval.id });
    return;
  }

  const updated = await prisma.approvalRequest.update({
    where: { id: approval.id },
    data: { status: 'rejected', rejectedAt: new Date(), rejectionReason: 'Rejected from Telegram' },
  });
  await markTelegramApprovalMessage(updated, 'rejected', callback);
  logger.info('Telegram rejection completed', { approvalId: approval.id });
}

async function sendApprovalPreviewMessageUnavailable(_chatId: number | string, text: string): Promise<void> {
  // Keep webhook failures isolated. The detailed status is already logged server-side.
  logger.info('Telegram callback unavailable', { text });
}

telegramRouter.post('/webhook', (req: Request, res: Response) => {
  if (!verifyTelegramWebhook(req)) return res.status(401).json({ error: 'Unauthorized' });

  // Respond immediately so Telegram never retries while content generation is running.
  res.sendStatus(200);
  void processTelegramCallback(req.body as TelegramUpdate).catch((error) => {
    logger.error('Telegram webhook callback processing failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  });
});
