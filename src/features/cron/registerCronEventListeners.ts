import { logger } from '../../observability/index.js';
import type { Services } from '../../bootstrap/factory/ServiceFactory.js';

const log = logger.child('RuntimeEvents');

export function registerCronEventListeners(services: Services): void {
  services.eventBus.on('cron.job.executed', async (event) => {
    log.info('定时任务执行事件', {
      jobId: event.jobId,
      jobName: event.jobName,
      target: event.target
    });
  });

  services.eventBus.on('cron.job.failed', async (event) => {
    log.warn('定时任务失败事件', {
      jobId: event.jobId,
      jobName: event.jobName,
      target: event.target,
      error: event.error.message
    });
  });
}
