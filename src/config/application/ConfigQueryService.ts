import type { Config } from '../schema.js';
import {
  getMainAgentConfig,
  getMainAgentRole,
  getMemoryConfig,
  getMemoryRecallConfig,
  getMemorySummaryConfig,
  getObservabilityConfig,
  getSessionRuntimeConfig,
  getToolRuntimeConfig,
  type ResolvedMainAgentConfig,
  type ResolvedMemoryConfig,
  type ResolvedMemoryRecallConfig,
  type ResolvedMemorySummaryConfig
} from '../selectors.js';
import type { ObservabilityConfig, ToolsConfig } from '../schema.js';
import type { ConfigSnapshotStore } from '../infrastructure/runtime/ConfigSnapshotStore.js';

export class ConfigQueryService {
  constructor(private readonly source: Config | ConfigSnapshotStore | { getConfig(): Config }) {}

  private getSource(): Config | { getConfig(): Config } {
    if (typeof (this.source as { getConfig?: () => Config }).getConfig === 'function') {
      return this.source as { getConfig(): Config };
    }

    return this.source as Config;
  }

  getConfig(): Config {
    if (typeof (this.source as { getConfig?: () => Config }).getConfig === 'function') {
      return (this.source as { getConfig(): Config }).getConfig();
    }

    return this.source as Config;
  }

  getMainAgentRole() {
    return getMainAgentRole(this.getSource());
  }

  getMainAgentConfig(): ResolvedMainAgentConfig {
    return getMainAgentConfig(this.getSource());
  }

  getMemoryConfig(): ResolvedMemoryConfig {
    return getMemoryConfig(this.getSource());
  }

  getMemorySummaryConfig(): ResolvedMemorySummaryConfig {
    return getMemorySummaryConfig(this.getSource());
  }

  getMemoryRecallConfig(): ResolvedMemoryRecallConfig {
    return getMemoryRecallConfig(this.getSource());
  }

  getSessionRuntimeConfig(): ResolvedMemoryConfig['session'] {
    return getSessionRuntimeConfig(this.getSource());
  }

  getToolRuntimeConfig(): ToolsConfig {
    return getToolRuntimeConfig(this.getSource());
  }

  getObservabilityConfig(): ObservabilityConfig {
    return getObservabilityConfig(this.getSource());
  }
}
