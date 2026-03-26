import type {
  Config,
  ToolsConfig,
  ObservabilityConfig
} from './schema/index.js';
import { ConfigSnapshotStore } from './infrastructure/runtime/ConfigSnapshotStore.js';
import {
  getMainAgentConfig,
  type ResolvedMainAgentConfig
} from './domain/mainAgent.js';
import {
  getMemoryConfig,
  getMemoryRecallConfig,
  getMemorySummaryConfig,
  ResolvedMemoryConfig,
  ResolvedMemoryRecallConfig,
  ResolvedMemorySummaryConfig
} from './domain/memory.js';
import { getObservabilityConfig } from './domain/observability.js';
import { getToolRuntimeConfig } from './domain/tools.js';

export class RuntimeConfigStore {
  private readonly snapshotStore: ConfigSnapshotStore;

  constructor(source: Config | ConfigSnapshotStore) {
    this.snapshotStore = source instanceof ConfigSnapshotStore
      ? source
      : new ConfigSnapshotStore(source);
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
    return getMainAgentConfig(this.snapshotStore);
  }

  getMemoryConfig(): ResolvedMemoryConfig {
    return getMemoryConfig(this.snapshotStore);
  }

  getMemorySummaryConfig(): ResolvedMemorySummaryConfig {
    return getMemorySummaryConfig(this.snapshotStore);
  }

  getMemoryRecallConfig(): ResolvedMemoryRecallConfig {
    return getMemoryRecallConfig(this.snapshotStore);
  }

  getToolRuntimeConfig(): ToolsConfig {
    return getToolRuntimeConfig(this.snapshotStore);
  }

  getObservabilityConfig(): ObservabilityConfig {
    return getObservabilityConfig(this.snapshotStore);
  }
}
