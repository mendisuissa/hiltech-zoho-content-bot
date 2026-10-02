import { requireCaller } from '../services/actionSecurity';
import { Router } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { runZohoScan } from '../services/zohoScanner';

export const scanRouter = Router();

scanRouter.post('/run', async (req, res, next) => {
  try {
    if (!requireCaller(req,res)) return;

    logger.info('Manual scan requested');
    const result = await runZohoScan();
    return res.json({ ok: true, result });
  } catch (error) {
    return next(error);
  }
});
