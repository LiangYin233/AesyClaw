import type { OutboundGateway } from '../../../agent/index.js';
import type { ConfigMutator, RuntimeConfigStore } from '../../../features/config/index.js';
import type { Config } from '../../../types.js';
import { logger } from '../../../platform/observability/index.js';
import type { ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import { PluginManager } from '../application/PluginManager.js';
import { normalizePluginConfigs } from '../domain/config.js';

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
      try {
        const { pluginConfigs: newPluginConfigs, changed } = await pluginManager.applyDefaultConfigs();
        if (changed) {
          const nextConfig = await updateConfig((draft) => {
            draft.plugins = newPluginConfigs as typeof draft.plugins;
          });
          pluginManager.setPluginConfigs(normalizePluginConfigs(nextConfig.plugins));
        }

        const latestConfig = configStore.getConfig();
        if (Object.keys(latestConfig.plugins).length > 0) {
          await pluginManager.loadFromConfig(normalizePluginConfigs(latestConfig.plugins));
        }
      } catch {
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
