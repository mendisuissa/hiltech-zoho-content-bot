import { schedule, type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export type SchedulerTask = () => Promise<void>;

let scheduledJob: ScheduledTask | null = null;

export function startLocalScheduler(task: SchedulerTask): void {
  if (!env.ENABLE_LOCAL_SCHEDULER) {
    logger.info('Local scheduler disabled');
    return;
  }

  if (scheduledJob) {
    return;
  }

  scheduledJob = schedule(env.CRON_SCHEDULE, async () => {
    try {
      logger.info('Scheduled scan started');
      await task();
      logger.info('Scheduled scan completed');
    } catch (error) {
      logger.error('Scheduled scan failed', error);
    }
  });

  logger.info('Local scheduler started', { cron: env.CRON_SCHEDULE });
}

export function stopLocalScheduler(): void {
  scheduledJob?.stop();
  scheduledJob = null;
}
