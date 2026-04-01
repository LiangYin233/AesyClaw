import { getMemoryConfig } from '../../../features/config/index.js';
import type { ConfigSource } from '../../../features/config/domain/shared.js';
import type { ConfigReloadTargets } from '../../config/reload/ports/ReloadTargets.js';
import type { Services } from '../../../app/bootstrap/factory/service-interfaces.js';
import { createMemoryRuntime } from './createMemoryRuntime.js';

function toConfigSource(config: import('../../../types.js').Config): ConfigSource {
  return { getConfig: () => config };
}

export function createMemoryReloadTarget(services: Services): NonNullable<ConfigReloadTargets['memory']> {
  return {
    applyConfig(config) {
      const source = toConfigSource(config);
      const memory = getMemoryConfig(source);
      const memoryService = createMemoryRuntime(source, services.sessionManager, services.longTermMemoryStore);
      services.agentRuntime.updateMemorySettings(memory.session.memoryWindow, memoryService as any);
    }
  };
}
