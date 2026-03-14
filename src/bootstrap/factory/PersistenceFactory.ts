import { join } from 'path';
import type { Config } from '../../types.js';
import { SessionMemoryService } from '../../agent/memory/SessionMemoryService.js';
import { SessionRoutingService } from '../../agent/session/SessionRoutingService.js';
import { MemoryFactStore, SessionManager } from '../../session/index.js';
import { logger } from '../../observability/index.js';
import { createProvider } from '../../providers/index.js';
import { resolveProviderSelection } from '../../config/index.js';

const log = logger.child('PersistenceFactory');

function createOptionalProvider(resolved: ReturnType<typeof resolveProviderSelection>, label: string) {
  if (!resolved.providerConfig) {
    log.warn(`${label} provider "${resolved.name}" not found in config`);
    return undefined;
  }

  return createProvider(resolved.name, resolved.providerConfig);
}

export function createMemoryService(
  config: Config,
  sessionManager: SessionManager,
  factsStore: MemoryFactStore
): SessionMemoryService | undefined {
  const summaryConfig = config.agent.defaults.memorySummary;
  const factsConfig = config.agent.defaults.memoryFacts;

  if (!summaryConfig.enabled && !factsConfig.enabled) {
    return undefined;
  }

  const summaryProviderConfig = resolveProviderSelection(config, summaryConfig.provider, summaryConfig.model);
  const factsProviderConfig = resolveProviderSelection(config, factsConfig.provider, factsConfig.model);

  const summaryRuntimeConfig = {
    enabled: summaryConfig.enabled,
    model: summaryProviderConfig.model,
    compressRounds: summaryConfig.compressRounds,
    memoryWindow: config.agent.defaults.memoryWindow
  };
  const factsRuntimeConfig = {
    enabled: factsConfig.enabled,
    model: factsProviderConfig.model,
    maxFacts: factsConfig.maxFacts
  };

  return new SessionMemoryService(
    sessionManager,
    factsStore,
    summaryConfig.enabled ? createOptionalProvider(summaryProviderConfig, 'Memory summary') : undefined,
    summaryRuntimeConfig,
    factsConfig.enabled ? createOptionalProvider(factsProviderConfig, 'Memory facts') : undefined,
    factsRuntimeConfig
  );
}

export async function createPersistenceServices(config: Config): Promise<{
  sessionManager: SessionManager;
  memoryFactStore: MemoryFactStore;
  memoryService?: SessionMemoryService;
  sessionRouting: SessionRoutingService;
}> {
  const sessionManager = new SessionManager(
    join(process.cwd(), '.aesyclaw', 'sessions'),
    config.agent.defaults.maxSessions
  );
  await sessionManager.loadAll();
  log.info(`SessionManager ready, ${sessionManager.count()} sessions loaded`);

  const memoryFactStore = new MemoryFactStore(sessionManager.getDatabase());
  const memoryService = createMemoryService(config, sessionManager, memoryFactStore);
  if (memoryService) {
    log.info('Memory service enabled');
  }

  return {
    sessionManager,
    memoryFactStore,
    memoryService,
    sessionRouting: new SessionRoutingService(sessionManager, config.agent.defaults.contextMode)
  };
}
