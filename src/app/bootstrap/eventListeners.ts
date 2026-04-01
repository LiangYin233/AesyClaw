import { registerCronEventListeners } from '../../features/cron/index.js';
import type { Services } from './factory/runtimeServiceTypes.js';

export function setupEventListeners(services: Services): void {
  registerCronEventListeners(services);
}
