import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'HilTech Zoho Content Bot',
    timestamp: new Date().toISOString(),
  });
});
