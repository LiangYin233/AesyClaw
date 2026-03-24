import type { Config, VisionSettings } from '../../../types.js';
import type { RuntimeConfigStore } from '../../../config/RuntimeConfigStore.js';
import type { ToolRegistry } from '../../../tools/ToolRegistry.js';
import type { APIServer } from '../../../api/server.js';
import type { ChannelManager } from '../../../channels/ChannelManager.js';
import type { MCPClientManager } from '../../../mcp/MCPClient.js';
import type { PluginManager, PluginConfigState } from '../../../plugins/index.js';
import type { SessionManager } from '../../../session/SessionManager.js';
import type { LongTermMemoryStore } from '../../../session/LongTermMemoryStore.js';
import type { SkillManager } from '../../../skills/SkillManager.js';
import type { LLMProvider } from '../../../providers/base.js';
import type { AgentRuntime } from '../../facade/AgentRuntime.js';
import type { SessionRoutingService } from '../../infrastructure/session/SessionRoutingService.js';

export interface ReloadRuntimeConfigInput {
  previousConfig: Config;
  currentConfig: Config;
}

export interface ReloadRuntimeConfigDeps {
  configStore: RuntimeConfigStore;
  agentRuntime: Pick<AgentRuntime, 'updateMainAgentRuntime' | 'updateMemorySettings'>;
  sessionRouting: Pick<SessionRoutingService, 'setContextMode'>;
  toolRegistry: Pick<ToolRegistry, 'setDefaultTimeout' | 'register' | 'list' | 'unregisterMany' | 'getSource'>;
  apiServer?: Pick<APIServer, 'updateConfig'>;
  channelManager: Pick<ChannelManager, 'getPlugin' | 'enableConfiguredChannel' | 'disableConfiguredChannel' | 'reconfigureChannel'>;
  pluginManager: Pick<PluginManager, 'loadFromConfig'>;
  mcpManager: MCPClientManager | null;
  setMcpManager: (manager: MCPClientManager) => void;
  sessionManager: SessionManager;
  longTermMemoryStore: LongTermMemoryStore;
  skillManager?: Pick<SkillManager, 'applyConfig'> | null;
  createProvider: (providerName: string, providerConfig: Config['providers'][string]) => LLMProvider;
  createMemoryService: (config: Config, sessionManager: SessionManager, longTermMemoryStore: LongTermMemoryStore) => unknown;
  syncConfiguredMcpServers: (binding: {
    getMcpManager: () => MCPClientManager | undefined;
    setMcpManager: (manager: MCPClientManager) => void;
    toolRegistry: Pick<ToolRegistry, 'register' | 'list' | 'unregisterMany' | 'getSource'>;
  }, config: Config) => Promise<void>;
  logging: {
    configure: (config: { level?: 'debug' | 'info' | 'warn' | 'error' }) => void;
  };
  logger: {
    info(message: string, fields?: Record<string, unknown>): void;
    debug(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
  };
  selectors: {
    getMainAgentConfig: typeof import('../../../config/index.js').getMainAgentConfig;
    getMemoryConfig: typeof import('../../../config/index.js').getMemoryConfig;
    getObservabilityConfig: typeof import('../../../config/index.js').getObservabilityConfig;
    getSessionRuntimeConfig: typeof import('../../../config/index.js').getSessionRuntimeConfig;
    getToolRuntimeConfig: typeof import('../../../config/index.js').getToolRuntimeConfig;
  };
}

interface ReloadRule {
  key: string;
  hasChanged: (currentConfig: Config, nextConfig: Config) => boolean;
  describe?: (currentConfig: Config, nextConfig: Config) => Record<string, unknown> | undefined;
  apply: (deps: ReloadRuntimeConfigDeps, currentConfig: Config, nextConfig: Config) => Promise<void> | void;
}

function compare(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function normalizePluginConfigs(
  configs: Record<string, { enabled?: boolean; options?: Record<string, unknown> }>
): Record<string, PluginConfigState> {
  return Object.fromEntries(
    Object.entries(configs).map(([name, config]) => [
      name,
      {
        enabled: config.enabled ?? false,
        options: config.options ? structuredClone(config.options) : undefined
      }
    ])
  );
}

function createVisionProvider(
  deps: ReloadRuntimeConfigDeps,
  config: Config,
  settings: VisionSettings
) {
  if (!settings.enabled || settings.directVision || !settings.fallbackProviderName || !settings.fallbackModelName) {
    return undefined;
  }

  const providerConfig = config.providers[settings.fallbackProviderName];
  if (!providerConfig) {
    deps.logger.warn('配置热重载时未找到视觉回退提供商', {
      provider: settings.fallbackProviderName
    });
    return undefined;
  }

  return deps.createProvider(settings.fallbackProviderName, providerConfig);
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
      apply: (ruleDeps, _currentConfig, nextConfig) => {
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
      apply: (ruleDeps, _currentConfig, nextConfig) => {
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
      apply: (ruleDeps, _currentConfig, nextConfig) => {
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
      apply: (ruleDeps, _currentConfig, nextConfig) => {
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
      apply: (ruleDeps, _currentConfig, nextConfig) => {
        ruleDeps.sessionRouting.setContextMode(ruleDeps.selectors.getSessionRuntimeConfig(nextConfig).contextMode);
      }
    },
    {
      key: 'channels-runtime',
      hasChanged: (currentConfig, nextConfig) => compare(currentConfig.channels) !== compare(nextConfig.channels),
      apply: async (ruleDeps, currentConfig, nextConfig) => {
        const channelNames = new Set([
          ...Object.keys(currentConfig.channels),
          ...Object.keys(nextConfig.channels)
        ]);

        for (const channelName of channelNames) {
          const previousChannelConfig = currentConfig.channels[channelName] as Record<string, unknown> | undefined;
          const nextChannelConfig = nextConfig.channels[channelName] as Record<string, unknown> | undefined;

          if (compare(previousChannelConfig) === compare(nextChannelConfig)) {
            continue;
          }

          if (!ruleDeps.channelManager.getPlugin(`channel_${channelName}`)) {
            ruleDeps.logger.warn('配置热重载时未找到渠道插件', { channel: channelName });
            continue;
          }

          const wasEnabled = Boolean(previousChannelConfig?.enabled);
          const isEnabled = Boolean(nextChannelConfig?.enabled);

          if (!wasEnabled && !isEnabled) {
            continue;
          }

          let success = true;
          let action = 'noop';

          if (wasEnabled && !isEnabled) {
            action = 'disable';
            success = await ruleDeps.channelManager.disableConfiguredChannel(channelName);
          } else if (!wasEnabled && isEnabled) {
            action = 'enable';
            success = await ruleDeps.channelManager.enableConfiguredChannel(channelName, nextChannelConfig ?? { enabled: true });
          } else {
            action = 'reconfigure';
            success = await ruleDeps.channelManager.reconfigureChannel(channelName, nextChannelConfig ?? { enabled: true });
          }

          if (!success) {
            throw new Error(`Failed to ${action} channel ${channelName} during config reload`);
          }
        }
      }
    },
    {
      key: 'plugins-runtime',
      hasChanged: (currentConfig, nextConfig) => compare(currentConfig.plugins) !== compare(nextConfig.plugins),
      apply: async (ruleDeps, _currentConfig, nextConfig) => {
        await ruleDeps.pluginManager.loadFromConfig(
          normalizePluginConfigs(nextConfig.plugins as Record<string, { enabled?: boolean; options?: Record<string, unknown> }>)
        );
      }
    },
    {
      key: 'skill-config',
      hasChanged: (currentConfig, nextConfig) => compare(currentConfig.skills) !== compare(nextConfig.skills),
      apply: (ruleDeps, _currentConfig, nextConfig) => {
        ruleDeps.skillManager?.applyConfig(nextConfig);
      }
    },
    {
      key: 'mcp-runtime',
      hasChanged: (currentConfig, nextConfig) => compare(currentConfig.mcp) !== compare(nextConfig.mcp),
      apply: async (ruleDeps, _currentConfig, nextConfig) => {
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
  const serverConfigChanged = compare(input.previousConfig.server) !== compare(input.currentConfig.server);

  if (triggeredRules.length === 0) {
    deps.configStore.setConfig(input.currentConfig);
    if (serverConfigChanged) {
      deps.apiServer?.updateConfig(input.currentConfig);
    }
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
    await rule.apply(deps, input.previousConfig, input.currentConfig);
  }

  deps.configStore.setConfig(input.currentConfig);
  if (serverConfigChanged) {
    deps.apiServer?.updateConfig(input.currentConfig);
  }

  deps.logger.info('配置热重载完成', {
    rules: triggeredRules.map((rule) => rule.key),
    durationMs: Date.now() - startedAt
  });
}
