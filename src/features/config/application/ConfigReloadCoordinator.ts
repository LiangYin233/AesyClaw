import type { Config } from '../schema/index.js';
import { getMainAgentConfig } from '../domain/mainAgent.js';
import { getMemoryConfig, getSessionRuntimeConfig } from '../domain/memory.js';
import { getObservabilityConfig } from '../domain/observability.js';
import { getToolRuntimeConfig } from '../domain/tools.js';
import type { ConfigReloadLogger, ConfigReloadTargets } from '../reload/ports/ReloadTargets.js';

interface ReloadRule {
  key: string;
  hasChanged: (previousConfig: Config, currentConfig: Config) => boolean;
  describe?: (previousConfig: Config, currentConfig: Config) => Record<string, unknown> | undefined;
  apply: (targets: ConfigReloadTargets, previousConfig: Config, currentConfig: Config) => Promise<void> | void;
  rollback: (targets: ConfigReloadTargets, previousConfig: Config, currentConfig: Config) => Promise<void> | void;
}

function compare(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function buildMainAgentComparable(config: Config) {
  const mainAgent = getMainAgentConfig(config);
  return {
    providerName: mainAgent.provider.name,
    providerConfig: mainAgent.provider.providerConfig ?? null,
    model: mainAgent.role.model,
    systemPrompt: mainAgent.role.systemPrompt,
    maxIterations: mainAgent.maxIterations,
    visionSettings: mainAgent.visionSettings,
    visionProviderConfig: mainAgent.visionProvider?.providerConfig ?? null
  };
}

function buildMemoryComparable(config: Config) {
  const memory = getMemoryConfig(config);
  return {
    memory,
    maintenanceProviderConfig: memory.facts.maintenance.providerConfig ?? null,
    recallProviderConfig: memory.facts.recall.providerConfig ?? null
  };
}

function buildRules(): ReloadRule[] {
  return [
    {
      key: 'observability',
      hasChanged: (previousConfig, currentConfig) =>
        compare(getObservabilityConfig(previousConfig)) !== compare(getObservabilityConfig(currentConfig)),
      describe: (previousConfig, currentConfig) => ({
        fromLevel: getObservabilityConfig(previousConfig).level,
        toLevel: getObservabilityConfig(currentConfig).level,
        fromBufferSize: getObservabilityConfig(previousConfig).bufferSize,
        toBufferSize: getObservabilityConfig(currentConfig).bufferSize,
        fromPretty: getObservabilityConfig(previousConfig).pretty,
        toPretty: getObservabilityConfig(currentConfig).pretty
      }),
      apply: async (targets, _previousConfig, currentConfig) => {
        await targets.observability?.applyConfig(currentConfig);
      },
      rollback: async (targets, previousConfig) => {
        await targets.observability?.applyConfig(previousConfig);
      }
    },
    {
      key: 'main-agent-runtime',
      hasChanged: (previousConfig, currentConfig) =>
        compare(buildMainAgentComparable(previousConfig)) !== compare(buildMainAgentComparable(currentConfig)),
      describe: (previousConfig, currentConfig) => {
        const previous = getMainAgentConfig(previousConfig);
        const next = getMainAgentConfig(currentConfig);
        return {
          fromProvider: previous.provider.name,
          toProvider: next.provider.name,
          fromModel: previous.role.model,
          toModel: next.role.model,
          fromMaxIterations: previous.maxIterations,
          toMaxIterations: next.maxIterations
        };
      },
      apply: async (targets, _previousConfig, currentConfig) => {
        await targets.mainAgent?.applyConfig(currentConfig);
      },
      rollback: async (targets, previousConfig) => {
        await targets.mainAgent?.applyConfig(previousConfig);
      }
    },
    {
      key: 'memory-service',
      hasChanged: (previousConfig, currentConfig) =>
        compare(buildMemoryComparable(previousConfig)) !== compare(buildMemoryComparable(currentConfig)),
      describe: (previousConfig, currentConfig) => {
        const previous = getMemoryConfig(previousConfig);
        const next = getMemoryConfig(currentConfig);
        return {
          fromWindow: previous.session.memoryWindow,
          toWindow: next.session.memoryWindow,
          fromRecallThreshold: previous.facts.recall.threshold,
          toRecallThreshold: next.facts.recall.threshold,
          fromRecallTopK: previous.facts.recall.topK,
          toRecallTopK: next.facts.recall.topK
        };
      },
      apply: async (targets, _previousConfig, currentConfig) => {
        await targets.memory?.applyConfig(currentConfig);
      },
      rollback: async (targets, previousConfig) => {
        await targets.memory?.applyConfig(previousConfig);
      }
    },
    {
      key: 'tool-runtime',
      hasChanged: (previousConfig, currentConfig) =>
        compare(getToolRuntimeConfig(previousConfig)) !== compare(getToolRuntimeConfig(currentConfig)),
      describe: (previousConfig, currentConfig) => ({
        fromTimeoutMs: getToolRuntimeConfig(previousConfig).timeoutMs,
        toTimeoutMs: getToolRuntimeConfig(currentConfig).timeoutMs
      }),
      apply: async (targets, _previousConfig, currentConfig) => {
        await targets.tools?.applyConfig(currentConfig);
      },
      rollback: async (targets, previousConfig) => {
        await targets.tools?.applyConfig(previousConfig);
      }
    },
    {
      key: 'session-routing',
      hasChanged: (previousConfig, currentConfig) =>
        getSessionRuntimeConfig(previousConfig).contextMode !== getSessionRuntimeConfig(currentConfig).contextMode,
      describe: (previousConfig, currentConfig) => ({
        fromContextMode: getSessionRuntimeConfig(previousConfig).contextMode,
        toContextMode: getSessionRuntimeConfig(currentConfig).contextMode
      }),
      apply: async (targets, _previousConfig, currentConfig) => {
        await targets.sessionRouting?.applyConfig(currentConfig);
      },
      rollback: async (targets, previousConfig) => {
        await targets.sessionRouting?.applyConfig(previousConfig);
      }
    },
    {
      key: 'channels-runtime',
      hasChanged: (previousConfig, currentConfig) => compare(previousConfig.channels) !== compare(currentConfig.channels),
      apply: async (targets, previousConfig, currentConfig) => {
        await targets.channels?.applyDiff(previousConfig, currentConfig);
      },
      rollback: async (targets, previousConfig, currentConfig) => {
        await targets.channels?.applyDiff(currentConfig, previousConfig);
      }
    },
    {
      key: 'plugins-runtime',
      hasChanged: (previousConfig, currentConfig) => compare(previousConfig.plugins) !== compare(currentConfig.plugins),
      apply: async (targets, _previousConfig, currentConfig) => {
        await targets.plugins?.applyConfig(currentConfig);
      },
      rollback: async (targets, previousConfig) => {
        await targets.plugins?.applyConfig(previousConfig);
      }
    },
    {
      key: 'skill-config',
      hasChanged: (previousConfig, currentConfig) => compare(previousConfig.skills) !== compare(currentConfig.skills),
      apply: async (targets, _previousConfig, currentConfig) => {
        await targets.skills?.applyConfig(currentConfig);
      },
      rollback: async (targets, previousConfig) => {
        await targets.skills?.applyConfig(previousConfig);
      }
    },
    {
      key: 'mcp-runtime',
      hasChanged: (previousConfig, currentConfig) => compare(previousConfig.mcp) !== compare(currentConfig.mcp),
      apply: async (targets, _previousConfig, currentConfig) => {
        await targets.mcp?.applyConfig(currentConfig);
      },
      rollback: async (targets, previousConfig) => {
        await targets.mcp?.applyConfig(previousConfig);
      }
    }
  ];
}

export class ConfigReloadCoordinator {
  private targets: ConfigReloadTargets = {};

  constructor(private readonly logger: ConfigReloadLogger) {}

  setTargets(targets: ConfigReloadTargets): void {
    this.targets = targets;
  }

  async reload(previousConfig: Config, currentConfig: Config): Promise<void> {
    const reloadRules = buildRules();
    const triggeredRules = reloadRules.filter((rule) => rule.hasChanged(previousConfig, currentConfig));
    const serverConfigChanged = compare(previousConfig.server) !== compare(currentConfig.server);
    const appliedRules: ReloadRule[] = [];

    if (triggeredRules.length === 0) {
      if (serverConfigChanged) {
        await this.targets.api?.applyConfig(currentConfig);
      }
      return;
    }

    try {
      for (const rule of triggeredRules) {
        rule.describe?.(previousConfig, currentConfig);
        await rule.apply(this.targets, previousConfig, currentConfig);
        appliedRules.push(rule);
      }

      if (serverConfigChanged) {
        await this.targets.api?.applyConfig(currentConfig);
      }
    } catch (error) {

      for (const rule of [...appliedRules].reverse()) {
        try {
          await rule.rollback(this.targets, previousConfig, currentConfig);
        } catch {
        }
      }

      if (serverConfigChanged) {
        await this.targets.api?.applyConfig(previousConfig);
      }

      throw error;
    }
  }
}
