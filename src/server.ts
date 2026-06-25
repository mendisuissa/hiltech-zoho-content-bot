import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { startLocalScheduler } from './services/schedulerService';
import { runZohoScan } from './services/zohoScanner';

const app = createApp();

startLocalScheduler(async () => {
  await runZohoScan();
});

app.listen(env.PORT, () => {
  logger.info('HilTech Zoho Content Bot started', {
    port: env.PORT,
    localScheduler: env.ENABLE_LOCAL_SCHEDULER,
  });
});
