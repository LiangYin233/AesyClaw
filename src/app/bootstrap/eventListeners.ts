import { registerCronEventListeners } from '../../features/cron/index.js';
import type { Services } from './factory/service-interfaces.js';

export function setupEventListeners(services: Services): void {
  registerCronEventListeners(services);
}
