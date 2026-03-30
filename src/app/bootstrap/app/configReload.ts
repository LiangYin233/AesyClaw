import {
  createVisionProviderFromSettings,
  getMainAgentConfig,
  getToolRuntimeConfig,
  resolveExecutionModel
} from '../../../features/config/index.js';
// Channel reload is now handled automatically by ChannelManager
import { createMcpReloadTarget } from '../../../features/mcp/index.js';
import { createMemoryReloadTarget } from '../../../features/memory/index.js';
import { createObservabilityReloadTarget } from '../../../features/observability/index.js';
import { createPluginsReloadTarget } from '../../../features/plugins/index.js';
import { createSessionRoutingReloadTarget } from '../../../features/sessions/index.js';
import { createSkillsReloadTarget } from '../../../features/skills/index.js';
import { createProvider } from '../../../platform/providers/index.js';
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
      applyDiff: async () => {
        // Channel configuration changes are handled automatically by ChannelManager
        // The new ChannelManager loads configuration on startup
        // For dynamic reload, you would restart the channel here
      }
    },
    plugins: createPluginsReloadTarget(services),
    skills: createSkillsReloadTarget(services),
    mcp: createMcpReloadTarget(services),
    api: {
      applyConfig(config) {
        services.webServer?.updateConfig(config);
      }
    }
  });
}
