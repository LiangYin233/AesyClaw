import type { OutboundGateway } from '../../../agent/index.js';
import type { ConfigMutator, RuntimeConfigStore } from '../../../features/config/index.js';
import type { Config } from '../../../types.js';
import { normalizeErrorMessage } from '../../../platform/errors/index.js';
import type { ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import { logger } from '../../../platform/observability/index.js';
import { PluginManager } from '../application/PluginManager.js';
import { normalizePluginConfigs } from '../domain/config.js';
import type { PluginConfigState } from '../domain/types.js';

const log = logger.child('PluginRuntimeFactory');

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
  pluginManager.setPluginConfigs(normalizePluginConfigs(config.plugins as Record<string, { enabled?: boolean; options?: Record<string, unknown> }>));

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
          error: normalizeErrorMessage(error)
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
