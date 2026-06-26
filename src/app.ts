import express from 'express';
import { healthRouter } from './routes/health';
import { scanRouter } from './routes/scan';
import { approvalsRouter } from './routes/approvals';
import { telegramRouter } from './routes/telegram';
import { executeHiltechKernelTask } from './services/kernelClient';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.use('/health', healthRouter);
  app.use('/api/scan', scanRouter);
  app.use('/api/approvals', approvalsRouter);
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
      const text = String(req.body?.text || '').trim();

      if (!text) {
        return res.status(400).json({ ok: false, error: 'Missing text' });
      }

      const result = await executeHiltechKernelTask(text);
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    res.status(500).json({ error: message });
  });

  return app;
}
