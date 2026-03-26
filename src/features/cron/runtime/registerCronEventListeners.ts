import type { Services } from '../../../app/bootstrap/factory/ServiceFactory.js';
export function registerCronEventListeners(services: Services): void {
  services.eventBus.on('cron.job.executed', async (_event) => {
  });

  services.eventBus.on('cron.job.failed', async (_event) => {
  });
}
