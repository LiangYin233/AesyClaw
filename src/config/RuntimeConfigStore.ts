import type {
  Config,
  ToolsConfig,
  ObservabilityConfig
} from './schema.js';
import { ConfigSnapshotStore } from './infrastructure/runtime/ConfigSnapshotStore.js';
import { ConfigQueryService } from './application/ConfigQueryService.js';
import type {
  ResolvedMainAgentConfig,
  ResolvedMemoryConfig,
  ResolvedMemoryRecallConfig,
  ResolvedMemorySummaryConfig
} from './selectors.js';

export class RuntimeConfigStore {
  private readonly snapshotStore: ConfigSnapshotStore;
  private readonly queryService: ConfigQueryService;

  constructor(source: Config | ConfigSnapshotStore) {
    this.snapshotStore = source instanceof ConfigSnapshotStore
      ? source
      : new ConfigSnapshotStore(source);
    this.queryService = new ConfigQueryService(this.snapshotStore);
  }

  getSnapshotStore(): ConfigSnapshotStore {
    return this.snapshotStore;
  }

  getConfig(): Config {
    return this.snapshotStore.getConfig();
  }

  setConfig(config: Config): void {
    this.snapshotStore.setConfig(config);
  }

  getMainAgentConfig(): ResolvedMainAgentConfig {
    return this.queryService.getMainAgentConfig();
  }

  getMemoryConfig(): ResolvedMemoryConfig {
    return this.queryService.getMemoryConfig();
  }

  getMemorySummaryConfig(): ResolvedMemorySummaryConfig {
    return this.queryService.getMemorySummaryConfig();
  }

  getMemoryRecallConfig(): ResolvedMemoryRecallConfig {
    return this.queryService.getMemoryRecallConfig();
  }

  getToolRuntimeConfig(): ToolsConfig {
    return this.queryService.getToolRuntimeConfig();
  }

  getObservabilityConfig(): ObservabilityConfig {
    return this.queryService.getObservabilityConfig();
  }
}
