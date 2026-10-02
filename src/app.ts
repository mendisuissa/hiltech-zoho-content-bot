import { requireCaller, heldResponse } from './services/actionSecurity';
import express from 'express';
import { healthRouter } from './routes/health';
import { scanRouter } from './routes/scan';
import { createApprovalsRouter } from './routes/approvals';
import { telegramRouter } from './routes/telegram';
import { dashboardRouter } from './routes/dashboard';
import { executeHiltechKernelTask } from './services/kernelClient';

export function createApp(options: {approvalBoundary?:any;kernelClient?:any} = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.use('/health', healthRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/scan', scanRouter);
  app.use('/api/approvals', createApprovalsRouter(options.approvalBoundary));
  app.use('/api/telegram', telegramRouter);
  app.get('/api/smart/health', (_req, res) => {
    return res.json({
      ok: true,
      service: 'HilaBot Smart Kernel Bridge',
      route: '/api/smart',
      tenantId: 'hiltech'
    });
  });
  app.post('/api/smart', async (req, res, next) => {
    try {
      if (!requireCaller(req,res)) return;
      if (!options.kernelClient) return heldResponse(res);
      const result = await options.kernelClient.execute(req,req.body);
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(503).json({ error: 'P0_REQUEST_UNAVAILABLE' });
  });

  return app;
}
