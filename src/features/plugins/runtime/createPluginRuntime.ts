import type { OutboundGateway } from '../../../agent/index.js';
import type { ConfigMutator, RuntimeConfigStore } from '../../../config/index.js';
import type { Config } from '../../../types.js';
import type { ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import { logger } from '../../../platform/observability/index.js';
import { PluginManager, type PluginConfigState } from '../../../plugins/index.js';

const log = logger.child('PluginRuntimeFactory');

function normalizeRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

function normalizePluginConfigs(
  configs: Record<string, { enabled?: boolean; options?: Record<string, any> }>
): Record<string, PluginConfigState> {
  return Object.fromEntries(
    Object.entries(configs).map(([name, config]) => [
      name,
      {
        enabled: config.enabled ?? false,
        options: config.options
      }
    ])
  );
}

export interface PluginRuntime {
  pluginManager: PluginManager;
  startBackgroundLoading: () => void;
  isBackgroundLoadingComplete: () => boolean;
}

export async function createPluginRuntime(args: {
  configStore: RuntimeConfigStore;
  outboundGateway: OutboundGateway;
  workspace: string;
  tempDir: string;
  toolRegistry: ToolRegistry;
  updateConfig: (mutator: ConfigMutator) => Promise<Config>;
}): Promise<PluginRuntime> {
  const { configStore, outboundGateway, workspace, tempDir, toolRegistry, updateConfig } = args;
  let started = false;
  let completed = false;

  const pluginManager = new PluginManager({
    getConfig: () => configStore.getConfig(),
    workspace,
    tempDir,
    toolRegistry,
    publishOutbound: async (message) => {
      await outboundGateway.send(message);
    },
    logger
  });

  const config = configStore.getConfig();
  pluginManager.setPluginConfigs(normalizePluginConfigs(config.plugins as Record<string, { enabled?: boolean; options?: Record<string, any> }>));

  const startBackgroundLoading = () => {
    if (started) {
      return;
    }
    started = true;

    void (async () => {
      const startedAt = Date.now();
      try {
        const { pluginConfigs: newPluginConfigs, changed } = await pluginManager.applyDefaultConfigs();
        if (changed) {
          const nextConfig = await updateConfig((draft) => {
            draft.plugins = newPluginConfigs as typeof draft.plugins;
          });
          configStore.setConfig(nextConfig);
          pluginManager.setPluginConfigs(normalizePluginConfigs(nextConfig.plugins));
          log.info('已应用默认插件配置');
        }

        const latestConfig = configStore.getConfig();
        if (Object.keys(latestConfig.plugins).length > 0) {
          await pluginManager.loadFromConfig(normalizePluginConfigs(latestConfig.plugins));
        }

        log.info('插件已在后台加载完成', {
          durationMs: Date.now() - startedAt
        });
      } catch (error) {
        log.error('后台加载插件失败', {
          error: normalizeRuntimeError(error)
        });
      } finally {
        completed = true;
      }
    })();
  };

  return {
    pluginManager,
    startBackgroundLoading,
    isBackgroundLoadingComplete: () => completed
  };
}
