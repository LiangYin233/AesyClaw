import {
  createVisionProviderFromSettings,
  resolveExecutionModel
} from '../../features/config/index.js';
import { getMainAgentConfig, getToolRuntimeConfig } from '../../platform/context/index.js';
import { createMcpReloadTarget } from '../../features/mcp/index.js';
import { createMemoryReloadTarget } from '../../features/memory/index.js';
import { createObservabilityReloadTarget } from '../../features/observability/index.js';
import { createSessionRoutingReloadTarget } from '../../features/sessions/index.js';
import { createSkillsReloadTarget } from '../../features/skills/index.js';
import { createProvider } from '../../platform/providers/index.js';
import { normalizePluginConfigs } from '../../features/extension/plugin/core/types.js';
import type { ChannelManager } from '../../features/extension/channel/ChannelManager.js';
import { logger } from '../../platform/observability/index.js';
import type { Config } from '../../types.js';
import type { Services } from './factory/service-interfaces.js';

interface ChannelConfig {
  enabled?: boolean;
  [key: string]: unknown;
}

interface ChannelDiffResult {
  toStart: string[];
  toStop: string[];
}

function computeChannelDiff(
  oldChannels: Record<string, ChannelConfig> = {},
  newChannels: Record<string, ChannelConfig> = {}
): ChannelDiffResult {
  const oldNames = new Set(Object.keys(oldChannels));
  const newNames = new Set(Object.keys(newChannels));
  const toStart: string[] = [];
  const toStop: string[] = [];

  for (const name of oldNames) {
    const wasEnabled = oldChannels[name]?.enabled ?? false;
    const shouldBeEnabled = newChannels[name]?.enabled ?? false;
    if (wasEnabled && !shouldBeEnabled) {
      toStop.push(name);
    }
  }

  for (const name of newNames) {
    const wasEnabled = oldChannels[name]?.enabled ?? false;
    const shouldBeEnabled = newChannels[name]?.enabled ?? false;
    if (!wasEnabled && shouldBeEnabled) {
      toStart.push(name);
    }
  }

  return { toStart, toStop };
}

async function applyChannelDiff(
  channelManager: ChannelManager,
  oldConfig: Config | undefined,
  newConfig: Config | undefined
): Promise<void> {
  const oldChannels = (oldConfig?.channels ?? {}) as Record<string, ChannelConfig>;
  const newChannels = (newConfig?.channels ?? {}) as Record<string, ChannelConfig>;

  channelManager.setChannelConfigs(newChannels);
  const { toStart, toStop } = computeChannelDiff(oldChannels, newChannels);

  await Promise.all([
    ...toStop.map(name => channelManager.stopChannel(name).catch(err => 
      logger.warn(`停止渠道失败`, { channel: name, error: err instanceof Error ? err.message : String(err) })
    )),
    ...toStart.map(name => channelManager.startChannel(name).catch(err => 
      logger.warn(`启动渠道失败`, { channel: name, error: err instanceof Error ? err.message : String(err) })
    ))
  ]);
}

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
        await applyChannelDiff(services.channelManager, oldConfig, newConfig);
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
