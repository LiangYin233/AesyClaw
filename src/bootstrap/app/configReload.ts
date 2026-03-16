import { ConfigLoader } from '../../config/loader.js';
import { getMainAgentRole, resolveProviderSelection } from '../../config/index.js';
import { createProvider } from '../../providers/index.js';
import { logger } from '../../observability/index.js';
import type { Services } from '../factory/ServiceFactory.js';
import { createMemoryService } from '../factory/ServiceFactory.js';
import type { Config, VisionSettings } from '../../types.js';

const log = logger.child('Bootstrap');

function hasProviderConfigChanged(currentConfig: Config, nextConfig: Config): boolean {
  const currentMainRole = getMainAgentRole(currentConfig);
  const nextMainRole = getMainAgentRole(nextConfig);
  const currentProvider = resolveProviderSelection(currentConfig, currentMainRole.provider, currentMainRole.model);
  const nextProvider = resolveProviderSelection(nextConfig, nextMainRole.provider, nextMainRole.model);

  return currentProvider.name !== nextProvider.name
    || currentProvider.model !== nextProvider.model
    || JSON.stringify(currentProvider.providerConfig || {}) !== JSON.stringify(nextProvider.providerConfig || {});
}

function buildVisionSettings(config: Config): VisionSettings {
  const mainRole = getMainAgentRole(config);
  return {
    enabled: mainRole.vision,
    reasoning: mainRole.reasoning,
    visionProviderName: mainRole.visionProvider || undefined,
    visionModelName: mainRole.visionModel || undefined
  };
}

function createVisionProvider(config: Config, settings: VisionSettings) {
  if (!settings.enabled || !settings.visionProviderName || !settings.visionModelName) {
    return undefined;
  }

  const providerConfig = config.providers[settings.visionProviderName];
  if (!providerConfig) {
    log.warn('配置热重载时未找到视觉提供商', {
      provider: settings.visionProviderName
    });
    return undefined;
  }

  return createProvider(settings.visionProviderName, providerConfig);
}

export async function applyRuntimeConfigUpdate(services: Services, currentConfig: Config, newConfig: Config): Promise<void> {
  const { agentRuntime, apiServer, sessionManager, memoryFactStore, skillManager } = services;
  const startedAt = Date.now();
  const oldMainRole = getMainAgentRole(currentConfig);
  const newMainRole = getMainAgentRole(newConfig);
  const visionSettings = buildVisionSettings(newConfig);

  const oldProvider = resolveProviderSelection(currentConfig, oldMainRole.provider, oldMainRole.model);
  const newProvider = resolveProviderSelection(newConfig, newMainRole.provider, newMainRole.model);

  if (hasProviderConfigChanged(currentConfig, newConfig) ||
      oldMainRole.systemPrompt !== newMainRole.systemPrompt ||
      oldMainRole.vision !== newMainRole.vision ||
      oldMainRole.reasoning !== newMainRole.reasoning ||
      oldMainRole.visionProvider !== newMainRole.visionProvider ||
      oldMainRole.visionModel !== newMainRole.visionModel ||
      currentConfig.agent.defaults.maxToolIterations !== newConfig.agent.defaults.maxToolIterations) {
    log.info('配置热重载：正在更新主运行时', {
      fromProvider: oldProvider.name,
      toProvider: newProvider.name,
      fromModel: oldProvider.model,
      toModel: newProvider.model
    });

    const runtimeUpdate: Parameters<typeof agentRuntime.updateMainAgentRuntime>[0] = {
      model: newMainRole.model,
      systemPrompt: newMainRole.systemPrompt,
      maxIterations: newConfig.agent.defaults.maxToolIterations,
      visionSettings,
      visionProvider: createVisionProvider(newConfig, visionSettings)
    };

    if (newProvider.providerConfig) {
      runtimeUpdate.provider = createProvider(newProvider.name, newProvider.providerConfig);
    } else {
      log.warn('配置热重载时未找到主提供商', { provider: newProvider.name });
    }

    agentRuntime.updateMainAgentRuntime(runtimeUpdate);
  }

  const memoryService = createMemoryService(newConfig, sessionManager, memoryFactStore);
  agentRuntime.updateMemorySettings(newConfig.agent.defaults.memoryWindow, memoryService);
  skillManager?.applyConfig(newConfig);

  services.config = newConfig;
  apiServer?.updateConfig(newConfig);

  log.info('配置热重载完成', {
    provider: newMainRole.provider,
    model: newMainRole.model,
    memoryWindow: newConfig.agent.defaults.memoryWindow,
    durationMs: Date.now() - startedAt
  });
}

export function setupConfigReload(services: Services): void {
  let currentConfig = services.config;

  ConfigLoader.onReload(async (newConfig) => {
    await applyRuntimeConfigUpdate(services, currentConfig, newConfig);
    currentConfig = newConfig;
  });
}
