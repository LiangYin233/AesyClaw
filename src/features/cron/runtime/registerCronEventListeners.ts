import type { Services } from '../../../app/bootstrap/factory/service-interfaces.js';
export function registerCronEventListeners(services: Services): void {
  services.eventBus.on('cron.job.executed', async (_event) => {
  });

  services.eventBus.on('cron.job.failed', async (_event) => {
  });
}
