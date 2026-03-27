import { registerCronEventListeners } from '../../../features/cron/index.js';
import type { Services } from '../factory/ServiceFactory.js';

export function setupEventListeners(services: Services): void {
  registerCronEventListeners(services);
}
