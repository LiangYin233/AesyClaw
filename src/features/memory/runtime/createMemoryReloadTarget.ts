import { getMemoryConfig } from '../../../platform/context/index.js';
import type { ConfigReloadTargets } from '../../config/reload/ports/ReloadTargets.js';
import type { Services } from '../../../app/bootstrap/factory/ServiceFactory.js';
import { createMemoryRuntime } from './createMemoryRuntime.js';

export function createMemoryReloadTarget(services: Services): NonNullable<ConfigReloadTargets['memory']> {
  return {
    applyConfig(config) {
      const memory = getMemoryConfig(config);
      const memoryService = createMemoryRuntime(config, services.sessionManager, services.longTermMemoryStore);
      services.agentRuntime.updateMemorySettings(memory.session.memoryWindow, memoryService as any);
    }
  };
}
