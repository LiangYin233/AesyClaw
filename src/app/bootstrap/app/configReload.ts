import {
  createVisionProviderFromSettings,
  resolveExecutionModel
} from '../../../features/config/index.js';
import { getMainAgentConfig, getToolRuntimeConfig } from '../../../platform/context/index.js';
// Channel reload is now handled automatically by ChannelManager
import { createMcpReloadTarget } from '../../../features/mcp/index.js';
import { createMemoryReloadTarget } from '../../../features/memory/index.js';
import { createObservabilityReloadTarget } from '../../../features/observability/index.js';

import { createSessionRoutingReloadTarget } from '../../../features/sessions/index.js';
import { createSkillsReloadTarget } from '../../../features/skills/index.js';
import { createProvider } from '../../../platform/providers/index.js';
import { normalizePluginConfigs } from '../../../features/extension/plugin/core/types.js';
import { logger } from '../../../platform/observability/index.js';
import type { Services } from '../factory/ServiceFactory.js';

export function setupConfigReload(services: Services): void {
  services.configManager.setReloadTargets({
    observability: createObservabilityReloadTarget(),
    mainAgent: {
      applyConfig(config) {
        const next = getMainAgentConfig(config);
        const runtimeUpdate: Parameters<typeof services.agentRuntime.updateMainAgentRuntime>[0] = {
          model: resolveExecutionModel(next.role.model),
          systemPrompt: next.role.systemPrompt,
          maxIterations: next.maxIterations,
          visionSettings: next.visionSettings,
          visionProvider: createVisionProviderFromSettings(config, next.visionSettings)
        };

        if (next.provider.providerConfig) {
          runtimeUpdate.provider = createProvider(next.provider.name, next.provider.providerConfig);
        }

        services.agentRuntime.updateMainAgentRuntime(runtimeUpdate);
      }
    },
    memory: createMemoryReloadTarget(services),
    tools: {
      applyConfig(config) {
        services.toolRegistry.setDefaultTimeout(getToolRuntimeConfig(config).timeoutMs);
      }
    },
    sessionRouting: createSessionRoutingReloadTarget(services),
    channels: {
      applyDiff: async (oldConfig, newConfig) => {
        const oldChannels = oldConfig?.channels ?? {};
        const newChannels = newConfig?.channels ?? {};

        const oldChannelNames = new Set(Object.keys(oldChannels));
        const newChannelNames = new Set(Object.keys(newChannels));

        for (const name of oldChannelNames) {
          const oldEntry = oldChannels[name] as { enabled?: boolean } | undefined;
          const newEntry = newChannels[name] as { enabled?: boolean } | undefined;
          const wasEnabled = oldEntry?.enabled ?? false;
          const shouldBeEnabled = newEntry?.enabled ?? false;

          if (wasEnabled && !shouldBeEnabled) {
            try {
              await services.channelManager.stopChannel(name);
            } catch (error) {
              logger.warn(`停止渠道失败: ${name}`, { error });
            }
          }
        }

        for (const name of newChannelNames) {
          const oldEntry = oldChannels[name] as { enabled?: boolean } | undefined;
          const newEntry = newChannels[name] as { enabled?: boolean } | undefined;
          const wasEnabled = oldEntry?.enabled ?? false;
          const shouldBeEnabled = newEntry?.enabled ?? false;

          if (!wasEnabled && shouldBeEnabled) {
            try {
              await services.channelManager.startChannel(name);
            } catch (error) {
              logger.warn(`启动渠道失败: ${name}`, { error });
            }
          }
        }
      }
    },
    plugins: {
      applyConfig: async (config) => {
        const pluginConfigs = normalizePluginConfigs(config.plugins);
        await services.pluginManager.load(pluginConfigs);
      }
    },
    skills: createSkillsReloadTarget(services),
    mcp: createMcpReloadTarget(services),
    api: {
      applyConfig(config) {
        services.webServer?.updateConfig(config);
      }
    }
  });
}
