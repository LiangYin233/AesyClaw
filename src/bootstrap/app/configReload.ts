import { ConfigLoader } from '../../config/loader.js';
import {
  getMainAgentConfig,
  getMemoryConfig,
  getObservabilityConfig,
  getSessionRuntimeConfig,
  getToolRuntimeConfig
} from '../../config/index.js';
import { logging, logger } from '../../observability/index.js';
import { createProvider } from '../../providers/index.js';
import type { Services } from '../factory/ServiceFactory.js';
import { createMemoryService } from '../factory/ServiceFactory.js';
import type { Config, VisionSettings } from '../../types.js';

const log = logger.child('Bootstrap');

type ReloadRule = {
  key: string;
  hasChanged: (currentConfig: Config, nextConfig: Config) => boolean;
  describe?: (currentConfig: Config, nextConfig: Config) => Record<string, unknown> | undefined;
  apply: (services: Services, nextConfig: Config) => Promise<void> | void;
};

function compare(value: unknown): string {
  return JSON.stringify(value ?? null);
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

function buildReloadRules(): ReloadRule[] {
  return [
    {
      key: 'observability',
      hasChanged: (currentConfig, nextConfig) =>
        compare(getObservabilityConfig(currentConfig)) !== compare(getObservabilityConfig(nextConfig)),
      describe: (currentConfig, nextConfig) => ({
        fromLevel: getObservabilityConfig(currentConfig).level,
        toLevel: getObservabilityConfig(nextConfig).level
      }),
      apply: (_services, nextConfig) => {
        logging.configure({
          level: getObservabilityConfig(nextConfig).level
        });
      }
    },
    {
      key: 'main-agent-runtime',
      hasChanged: (currentConfig, nextConfig) =>
        compare(buildMainAgentComparable(currentConfig)) !== compare(buildMainAgentComparable(nextConfig)),
      describe: (currentConfig, nextConfig) => {
        const previous = getMainAgentConfig(currentConfig);
        const next = getMainAgentConfig(nextConfig);
        return {
          fromProvider: previous.provider.name,
          toProvider: next.provider.name,
          fromModel: previous.role.model,
          toModel: next.role.model,
          fromMaxIterations: previous.maxIterations,
          toMaxIterations: next.maxIterations
        };
      },
      apply: (services, nextConfig) => {
        const next = getMainAgentConfig(nextConfig);
        const runtimeUpdate: Parameters<typeof services.agentRuntime.updateMainAgentRuntime>[0] = {
          model: next.role.model,
          systemPrompt: next.role.systemPrompt,
          maxIterations: next.maxIterations,
          visionSettings: next.visionSettings,
          visionProvider: createVisionProvider(nextConfig, next.visionSettings)
        };

        if (next.provider.providerConfig) {
          runtimeUpdate.provider = createProvider(next.provider.name, next.provider.providerConfig);
        } else {
          log.warn('配置热重载时未找到主提供商', { provider: next.provider.name });
        }

        services.agentRuntime.updateMainAgentRuntime(runtimeUpdate);
      }
    },
    {
      key: 'memory-service',
      hasChanged: (currentConfig, nextConfig) =>
        compare(buildMemoryComparable(currentConfig)) !== compare(buildMemoryComparable(nextConfig)),
      describe: (currentConfig, nextConfig) => {
        const previous = getMemoryConfig(currentConfig);
        const next = getMemoryConfig(nextConfig);
        return {
          fromWindow: previous.session.memoryWindow,
          toWindow: next.session.memoryWindow,
          fromRecallThreshold: previous.facts.recall.threshold,
          toRecallThreshold: next.facts.recall.threshold,
          fromRecallTopK: previous.facts.recall.topK,
          toRecallTopK: next.facts.recall.topK
        };
      },
      apply: (services, nextConfig) => {
        const memory = getMemoryConfig(nextConfig);
        const memoryService = createMemoryService(nextConfig, services.sessionManager, services.longTermMemoryStore);
        services.agentRuntime.updateMemorySettings(memory.session.memoryWindow, memoryService);
      }
    },
    {
      key: 'tool-runtime',
      hasChanged: (currentConfig, nextConfig) =>
        compare(getToolRuntimeConfig(currentConfig)) !== compare(getToolRuntimeConfig(nextConfig)),
      describe: (currentConfig, nextConfig) => ({
        fromTimeoutMs: getToolRuntimeConfig(currentConfig).timeoutMs,
        toTimeoutMs: getToolRuntimeConfig(nextConfig).timeoutMs
      }),
      apply: (services, nextConfig) => {
        services.toolRegistry.setDefaultTimeout(getToolRuntimeConfig(nextConfig).timeoutMs);
      }
    },
    {
      key: 'session-routing',
      hasChanged: (currentConfig, nextConfig) =>
        getSessionRuntimeConfig(currentConfig).contextMode !== getSessionRuntimeConfig(nextConfig).contextMode,
      describe: (currentConfig, nextConfig) => ({
        fromContextMode: getSessionRuntimeConfig(currentConfig).contextMode,
        toContextMode: getSessionRuntimeConfig(nextConfig).contextMode
      }),
      apply: (services, nextConfig) => {
        services.sessionRouting.setContextMode(getSessionRuntimeConfig(nextConfig).contextMode);
      }
    },
    {
      key: 'skill-config',
      hasChanged: (currentConfig, nextConfig) => compare(currentConfig.skills) !== compare(nextConfig.skills),
      apply: (services, nextConfig) => {
        services.skillManager?.applyConfig(nextConfig);
      }
    },
    {
      key: 'api-server-config',
      hasChanged: (currentConfig, nextConfig) => compare(currentConfig.server) !== compare(nextConfig.server),
      apply: (services, nextConfig) => {
        services.apiServer?.updateConfig(nextConfig);
      }
    }
  ];
}

export async function applyRuntimeConfigUpdate(services: Services, currentConfig: Config, newConfig: Config): Promise<void> {
  const startedAt = Date.now();
  const reloadRules = buildReloadRules();
  const triggeredRules = reloadRules.filter((rule) => rule.hasChanged(currentConfig, newConfig));

  services.configStore.setConfig(newConfig);
  services.config = newConfig;

  if (triggeredRules.length === 0) {
    log.debug('配置热重载：未检测到需要更新的运行时规则');
    return;
  }

  log.info('配置热重载：触发规则', {
    rules: triggeredRules.map((rule) => rule.key)
  });

  for (const rule of triggeredRules) {
    const details = rule.describe?.(currentConfig, newConfig);
    log.info('配置热重载：应用规则', {
      rule: rule.key,
      ...(details || {})
    });
    await rule.apply(services, newConfig);
  }

  log.info('配置热重载完成', {
    rules: triggeredRules.map((rule) => rule.key),
    durationMs: Date.now() - startedAt
  });
}

export function setupConfigReload(services: Services): void {
  let currentConfig = services.configStore.getConfig();

  ConfigLoader.onReload(async (newConfig) => {
    await applyRuntimeConfigUpdate(services, currentConfig, newConfig);
    currentConfig = newConfig;
  });
}
