import type { Config } from '../../types.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { OutboundGateway } from '../../agent/runtime/AgentRuntime.js';
import { PluginManager } from '../../plugins/index.js';
import type { PluginConfigState } from '../../plugins/index.js';
import { ConfigLoader } from '../../config/loader.js';
import { logger } from '../../observability/index.js';
import { normalizeError } from '../../errors/index.js';

const log = logger.child('PluginRuntimeFactory');

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

export async function createPluginManager(args: {
  config: Config;
  outboundGateway: OutboundGateway;
  workspace: string;
  tempDir: string;
  toolRegistry: ToolRegistry;
}): Promise<PluginRuntime> {
  const { config, outboundGateway, workspace, tempDir, toolRegistry } = args;
  let started = false;
  let completed = false;

  const pluginManager = new PluginManager({
    getConfig: () => ConfigLoader.get(),
    workspace,
    tempDir,
    toolRegistry,
    publishOutbound: async (message) => {
      await outboundGateway.send(message);
    },
    logger
  });

  pluginManager.setPluginConfigs(normalizePluginConfigs(config.plugins as Record<string, { enabled?: boolean; options?: Record<string, any> }>));

  const startBackgroundLoading = () => {
    if (started) {
      return;
    }
    started = true;

    void (async () => {
      const startedAt = Date.now();
      try {
        const newPluginConfigs = await pluginManager.applyDefaultConfigs();
        if (Object.keys(newPluginConfigs).length > 0) {
          const nextConfig = await ConfigLoader.update((draft) => {
            draft.plugins = newPluginConfigs as typeof draft.plugins;
          });
          config.plugins = nextConfig.plugins;
          pluginManager.setPluginConfigs(normalizePluginConfigs(nextConfig.plugins));
          log.info('已应用默认插件配置');
        }

        if (Object.keys(config.plugins).length > 0) {
          await pluginManager.loadFromConfig(normalizePluginConfigs(config.plugins));
        }

        log.info('插件已在后台加载完成', {
          durationMs: Date.now() - startedAt
        });
      } catch (error) {
        log.error('后台加载插件失败', {
          error: normalizeError(error)
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
