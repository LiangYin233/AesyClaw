import { logger } from '../../platform/observability/index.js';
import type { Services } from '../../app/bootstrap/factory/ServiceFactory.js';

const log = logger.child('RuntimeEvents');

export function registerBackgroundTaskEventListeners(services: Services): void {
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
}
