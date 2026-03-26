import {
  createVisionProviderFromSettings,
  getMainAgentConfig,
  getToolRuntimeConfig,
  resolveExecutionModel
} from '../../../features/config/index.js';
import { logger } from '../../../platform/observability/index.js';
import { createChannelsReloadTarget } from '../../../features/channels/index.js';
import { createMcpReloadTarget } from '../../../features/mcp/index.js';
import { createMemoryReloadTarget } from '../../../features/memory/createMemoryReloadTarget.js';
import { createObservabilityReloadTarget } from '../../../features/observability/createObservabilityReloadTarget.js';
import { createPluginsReloadTarget } from '../../../features/plugins/index.js';
import { createSessionRoutingReloadTarget } from '../../../features/sessions/index.js';
import { createSkillsReloadTarget } from '../../../features/skills/createSkillsReloadTarget.js';
import { createProvider } from '../../../platform/providers/index.js';
import type { Services } from '../factory/ServiceFactory.js';

const log = logger.child('Bootstrap');

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
          visionProvider: createVisionProviderFromSettings(config, next.visionSettings, {
            onMissingProvider: (providerName) => {
              log.warn('配置热重载时未找到视觉回退提供商', {
                provider: providerName
              });
            }
          })
        };

        if (next.provider.providerConfig) {
          runtimeUpdate.provider = createProvider(next.provider.name, next.provider.providerConfig);
        } else {
          log.warn('配置热重载时未找到主提供商', { provider: next.provider.name });
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
    channels: createChannelsReloadTarget(services),
    plugins: createPluginsReloadTarget(services),
    skills: createSkillsReloadTarget(services),
    mcp: createMcpReloadTarget(services),
    api: {
      applyConfig(config) {
        services.apiServer?.updateConfig(config);
      }
    }
  });
}
