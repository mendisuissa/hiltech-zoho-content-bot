import express from 'express';
import { healthRouter } from './routes/health';
import { scanRouter } from './routes/scan';
import { approvalsRouter } from './routes/approvals';
import { telegramRouter } from './routes/telegram';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.use('/health', healthRouter);
  app.use('/api/scan', scanRouter);
  app.use('/api/approvals', approvalsRouter);
  app.use('/api/telegram', telegramRouter);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    res.status(500).json({ error: message });
  });

  return app;
}
