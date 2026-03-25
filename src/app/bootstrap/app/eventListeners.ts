import { registerBackgroundTaskEventListeners } from '../../../agent/assembly/registerBackgroundTaskEventListeners.js';
import { registerCronEventListeners } from '../../../features/cron/index.js';
import type { Services } from '../factory/ServiceFactory.js';

export function setupEventListeners(services: Services): void {
  registerBackgroundTaskEventListeners(services);
  registerCronEventListeners(services);
}
