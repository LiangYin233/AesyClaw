import type { Config, VisionSettings } from '../../../types.js';
import type { ReloadRuntimeConfigDeps, ReloadRule } from './deps.js';
import type { ReloadRuntimeConfigInput } from './contracts.js';

function compare(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function createVisionProvider(
  deps: ReloadRuntimeConfigDeps,
  config: Config,
  settings: VisionSettings
) {
  if (!settings.enabled || !settings.visionProviderName || !settings.visionModelName) {
    return undefined;
  }

  const providerConfig = config.providers[settings.visionProviderName];
  if (!providerConfig) {
    deps.logger.warn('配置热重载时未找到视觉提供商', {
      provider: settings.visionProviderName
    });
    return undefined;
  }

  return deps.createProvider(settings.visionProviderName, providerConfig);
}

function buildMainAgentComparable(deps: ReloadRuntimeConfigDeps, config: Config) {
  const mainAgent = deps.selectors.getMainAgentConfig(config);
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

function buildMemoryComparable(deps: ReloadRuntimeConfigDeps, config: Config) {
  const memory = deps.selectors.getMemoryConfig(config);
  return {
    memory,
    maintenanceProviderConfig: memory.facts.maintenance.providerConfig ?? null,
    recallProviderConfig: memory.facts.recall.providerConfig ?? null
  };
}

function buildReloadRules(deps: ReloadRuntimeConfigDeps): ReloadRule[] {
  return [
    {
      key: 'observability',
      hasChanged: (currentConfig, nextConfig) =>
        compare(deps.selectors.getObservabilityConfig(currentConfig)) !== compare(deps.selectors.getObservabilityConfig(nextConfig)),
      describe: (currentConfig, nextConfig) => ({
        fromLevel: deps.selectors.getObservabilityConfig(currentConfig).level,
        toLevel: deps.selectors.getObservabilityConfig(nextConfig).level
      }),
      apply: (ruleDeps, nextConfig) => {
        ruleDeps.logging.configure({
          level: ruleDeps.selectors.getObservabilityConfig(nextConfig).level
        });
      }
    },
    {
      key: 'main-agent-runtime',
      hasChanged: (currentConfig, nextConfig) =>
        compare(buildMainAgentComparable(deps, currentConfig)) !== compare(buildMainAgentComparable(deps, nextConfig)),
      describe: (currentConfig, nextConfig) => {
        const previous = deps.selectors.getMainAgentConfig(currentConfig);
        const next = deps.selectors.getMainAgentConfig(nextConfig);
        return {
          fromProvider: previous.provider.name,
          toProvider: next.provider.name,
          fromModel: previous.role.model,
          toModel: next.role.model,
          fromMaxIterations: previous.maxIterations,
          toMaxIterations: next.maxIterations
        };
      },
      apply: (ruleDeps, nextConfig) => {
        const next = ruleDeps.selectors.getMainAgentConfig(nextConfig);
        const runtimeUpdate: Parameters<typeof ruleDeps.agentRuntime.updateMainAgentRuntime>[0] = {
          model: next.role.model,
          systemPrompt: next.role.systemPrompt,
          maxIterations: next.maxIterations,
          visionSettings: next.visionSettings,
          visionProvider: createVisionProvider(ruleDeps, nextConfig, next.visionSettings)
        };

        if (next.provider.providerConfig) {
          runtimeUpdate.provider = ruleDeps.createProvider(next.provider.name, next.provider.providerConfig);
        } else {
          ruleDeps.logger.warn('配置热重载时未找到主提供商', { provider: next.provider.name });
        }

        ruleDeps.agentRuntime.updateMainAgentRuntime(runtimeUpdate);
      }
    },
    {
      key: 'memory-service',
      hasChanged: (currentConfig, nextConfig) =>
        compare(buildMemoryComparable(deps, currentConfig)) !== compare(buildMemoryComparable(deps, nextConfig)),
      describe: (currentConfig, nextConfig) => {
        const previous = deps.selectors.getMemoryConfig(currentConfig);
        const next = deps.selectors.getMemoryConfig(nextConfig);
        return {
          fromWindow: previous.session.memoryWindow,
          toWindow: next.session.memoryWindow,
          fromRecallThreshold: previous.facts.recall.threshold,
          toRecallThreshold: next.facts.recall.threshold,
          fromRecallTopK: previous.facts.recall.topK,
          toRecallTopK: next.facts.recall.topK
        };
      },
      apply: (ruleDeps, nextConfig) => {
        const memory = ruleDeps.selectors.getMemoryConfig(nextConfig);
        const memoryService = ruleDeps.createMemoryService(nextConfig, ruleDeps.sessionManager, ruleDeps.longTermMemoryStore);
        ruleDeps.agentRuntime.updateMemorySettings(memory.session.memoryWindow, memoryService as any);
      }
    },
    {
      key: 'tool-runtime',
      hasChanged: (currentConfig, nextConfig) =>
        compare(deps.selectors.getToolRuntimeConfig(currentConfig)) !== compare(deps.selectors.getToolRuntimeConfig(nextConfig)),
      describe: (currentConfig, nextConfig) => ({
        fromTimeoutMs: deps.selectors.getToolRuntimeConfig(currentConfig).timeoutMs,
        toTimeoutMs: deps.selectors.getToolRuntimeConfig(nextConfig).timeoutMs
      }),
      apply: (ruleDeps, nextConfig) => {
        ruleDeps.toolRegistry.setDefaultTimeout(ruleDeps.selectors.getToolRuntimeConfig(nextConfig).timeoutMs);
      }
    },
    {
      key: 'session-routing',
      hasChanged: (currentConfig, nextConfig) =>
        deps.selectors.getSessionRuntimeConfig(currentConfig).contextMode !== deps.selectors.getSessionRuntimeConfig(nextConfig).contextMode,
      describe: (currentConfig, nextConfig) => ({
        fromContextMode: deps.selectors.getSessionRuntimeConfig(currentConfig).contextMode,
        toContextMode: deps.selectors.getSessionRuntimeConfig(nextConfig).contextMode
      }),
      apply: (ruleDeps, nextConfig) => {
        ruleDeps.sessionRouting.setContextMode(ruleDeps.selectors.getSessionRuntimeConfig(nextConfig).contextMode);
      }
    },
    {
      key: 'skill-config',
      hasChanged: (currentConfig, nextConfig) => compare(currentConfig.skills) !== compare(nextConfig.skills),
      apply: (ruleDeps, nextConfig) => {
        ruleDeps.skillManager?.applyConfig(nextConfig);
      }
    },
    {
      key: 'api-server-config',
      hasChanged: (currentConfig, nextConfig) => compare(currentConfig.server) !== compare(nextConfig.server),
      apply: (ruleDeps, nextConfig) => {
        ruleDeps.apiServer?.updateConfig(nextConfig);
      }
    },
    {
      key: 'mcp-runtime',
      hasChanged: (currentConfig, nextConfig) => compare(currentConfig.mcp) !== compare(nextConfig.mcp),
      apply: async (ruleDeps, nextConfig) => {
        await ruleDeps.syncConfiguredMcpServers({
          getMcpManager: () => ruleDeps.mcpManager ?? undefined,
          setMcpManager: (manager) => {
            ruleDeps.setMcpManager(manager);
          },
          toolRegistry: ruleDeps.toolRegistry
        }, nextConfig);
      }
    }
  ];
}

export async function reloadRuntimeConfig(
  deps: ReloadRuntimeConfigDeps,
  input: ReloadRuntimeConfigInput
): Promise<void> {
  const startedAt = Date.now();
  const reloadRules = buildReloadRules(deps);
  const triggeredRules = reloadRules.filter((rule) => rule.hasChanged(input.previousConfig, input.currentConfig));

  deps.configStore.setConfig(input.currentConfig);

  if (triggeredRules.length === 0) {
    deps.logger.debug('配置热重载：未检测到需要更新的运行时规则');
    return;
  }

  deps.logger.info('配置热重载：触发规则', {
    rules: triggeredRules.map((rule) => rule.key)
  });

  for (const rule of triggeredRules) {
    const details = rule.describe?.(input.previousConfig, input.currentConfig);
    deps.logger.info('配置热重载：应用规则', {
      rule: rule.key,
      ...(details || {})
    });
    await rule.apply(deps, input.currentConfig);
  }

  deps.logger.info('配置热重载完成', {
    rules: triggeredRules.map((rule) => rule.key),
    durationMs: Date.now() - startedAt
  });
}
