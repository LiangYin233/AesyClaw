import {
  getMainAgentConfig,
  getMemoryConfig,
  getMemoryRecallConfig,
  getMemorySummaryConfig,
  getObservabilityConfig,
  type ResolvedMainAgentConfig,
  type ResolvedMemoryConfig,
  type ResolvedMemoryRecallConfig,
  type ResolvedMemorySummaryConfig,
  getToolRuntimeConfig
} from './selectors.js';
import type {
  Config,
  ToolsConfig,
  ObservabilityConfig
} from './schema.js';

export class RuntimeConfigStore {
  constructor(private currentConfig: Config) {}

  getConfig(): Config {
    return this.currentConfig;
  }

  setConfig(config: Config): void {
    this.currentConfig = config;
  }

  getMainAgentConfig(): ResolvedMainAgentConfig {
    return getMainAgentConfig(this.currentConfig);
  }

  getMemoryConfig(): ResolvedMemoryConfig {
    return getMemoryConfig(this.currentConfig);
  }

  getMemorySummaryConfig(): ResolvedMemorySummaryConfig {
    return getMemorySummaryConfig(this.currentConfig);
  }

  getMemoryRecallConfig(): ResolvedMemoryRecallConfig {
    return getMemoryRecallConfig(this.currentConfig);
  }

  getToolRuntimeConfig(): ToolsConfig {
    return getToolRuntimeConfig(this.currentConfig);
  }

  getObservabilityConfig(): ObservabilityConfig {
    return getObservabilityConfig(this.currentConfig);
  }
}
