import type { Services } from '../../app/bootstrap/factory/ServiceFactory.js';

export function registerBackgroundTaskEventListeners(services: Services): void {
  services.eventBus.on('background_task.completed', async (_event) => {
  });

  services.eventBus.on('background_task.failed', async (_event) => {
  });
}
