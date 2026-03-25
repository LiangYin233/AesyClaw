import {
  getMainAgentConfig,
  getMemoryConfig,
  getObservabilityConfig,
  getSessionRuntimeConfig,
  getToolRuntimeConfig,
  resolveExecutionModel
} from '../../config/index.js';
import { logging, logger } from '../../observability/index.js';
import { syncConfiguredMcpServers } from '../../mcp/runtime.js';
import { createProvider } from '../../providers/index.js';
import type { Services } from '../factory/ServiceFactory.js';
import { createMemoryService } from '../factory/createPersistenceServices.js';

const log = logger.child('Bootstrap');

function normalizePluginConfigs(
  configs: Record<string, { enabled?: boolean; options?: Record<string, unknown> }>
) {
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

function createVisionProvider(config: Services['config'], settings: ReturnType<typeof getMainAgentConfig>['visionSettings']) {
  if (!settings.enabled || settings.directVision || !settings.fallbackProviderName || !settings.fallbackModelName) {
    return undefined;
  }

  const providerConfig = config.providers[settings.fallbackProviderName];
  if (!providerConfig) {
    log.warn('配置热重载时未找到视觉回退提供商', {
      provider: settings.fallbackProviderName
    });
    return undefined;
  }

  return createProvider(settings.fallbackProviderName, providerConfig);
}

export function setupConfigReload(services: Services): void {
  services.configManager.setReloadTargets({
    observability: {
      applyConfig(config) {
        logging.configure({
          level: getObservabilityConfig(config).level
        });
      }
    },
    mainAgent: {
      applyConfig(config) {
        const next = getMainAgentConfig(config);
        const runtimeUpdate: Parameters<typeof services.agentRuntime.updateMainAgentRuntime>[0] = {
          model: resolveExecutionModel(next.role.model),
          systemPrompt: next.role.systemPrompt,
          maxIterations: next.maxIterations,
          visionSettings: next.visionSettings,
          visionProvider: createVisionProvider(config, next.visionSettings)
        };

        if (next.provider.providerConfig) {
          runtimeUpdate.provider = createProvider(next.provider.name, next.provider.providerConfig);
        } else {
          log.warn('配置热重载时未找到主提供商', { provider: next.provider.name });
        }

        services.agentRuntime.updateMainAgentRuntime(runtimeUpdate);
      }
    },
    memory: {
      applyConfig(config) {
        const memory = getMemoryConfig(config);
        const memoryService = createMemoryService(config, services.sessionManager, services.longTermMemoryStore);
        services.agentRuntime.updateMemorySettings(memory.session.memoryWindow, memoryService as any);
      }
    },
    tools: {
      applyConfig(config) {
        services.toolRegistry.setDefaultTimeout(getToolRuntimeConfig(config).timeoutMs);
      }
    },
    sessionRouting: {
      applyConfig(config) {
        services.sessionRouting.setContextMode(getSessionRuntimeConfig(config).contextMode);
      }
    },
    channels: {
      async applyDiff(previousConfig, currentConfig) {
        const channelNames = new Set([
          ...Object.keys(previousConfig.channels),
          ...Object.keys(currentConfig.channels)
        ]);

        for (const channelName of channelNames) {
          const previousChannelConfig = previousConfig.channels[channelName] as Record<string, unknown> | undefined;
          const nextChannelConfig = currentConfig.channels[channelName] as Record<string, unknown> | undefined;

          if (JSON.stringify(previousChannelConfig) === JSON.stringify(nextChannelConfig)) {
            continue;
          }

          if (!services.channelManager.getPlugin(`channel_${channelName}`)) {
            log.warn('配置热重载时未找到渠道插件', { channel: channelName });
            continue;
          }

          const wasEnabled = Boolean(previousChannelConfig?.enabled);
          const isEnabled = Boolean(nextChannelConfig?.enabled);

          if (!wasEnabled && !isEnabled) {
            continue;
          }

          let success = true;
          if (wasEnabled && !isEnabled) {
            success = await services.channelManager.disableChannel(channelName);
          } else if (!wasEnabled && isEnabled) {
            success = await services.channelManager.enableChannel(channelName, nextChannelConfig ?? { enabled: true });
          } else {
            success = await services.channelManager.reconfigureChannel(channelName, nextChannelConfig ?? { enabled: true });
          }

          if (!success) {
            throw new Error(`Failed to reload channel ${channelName}`);
          }
        }
      }
    },
    plugins: {
      async applyConfig(config) {
        await services.pluginManager.loadFromConfig(
          normalizePluginConfigs(config.plugins as Record<string, { enabled?: boolean; options?: Record<string, unknown> }>)
        );
      }
    },
    skills: {
      applyConfig(config) {
        services.skillManager?.applyConfig(config);
      }
    },
    mcp: {
      async applyConfig(config) {
        await syncConfiguredMcpServers({
          getMcpManager: () => services.mcpManager ?? undefined,
          setMcpManager: (manager) => {
            services.mcpManager = manager;
          },
          toolRegistry: services.toolRegistry
        }, config);
      }
    },
    api: {
      applyConfig(config) {
        services.apiServer?.updateConfig(config);
      }
    }
  });
}
