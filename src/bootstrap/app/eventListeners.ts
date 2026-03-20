import { logger } from '../../observability/index.js';
import type { Services } from '../factory/ServiceFactory.js';

const log = logger.child('RuntimeEvents');

export function setupEventListeners(services: Services): void {
  services.eventBus.on('background_task.completed', async (event) => {
    log.info('后台任务完成事件', {
      sessionKey: event.sessionKey,
      taskId: event.taskId,
      channel: event.channel,
      chatId: event.chatId
    });
  });

  services.eventBus.on('background_task.failed', async (event) => {
    log.warn('后台任务失败事件', {
      sessionKey: event.sessionKey,
      taskId: event.taskId,
      error: event.error.message
    });
  });

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
