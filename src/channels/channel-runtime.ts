import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { ChannelPipeline } from '@/agent/pipeline.js';
import { logger } from '@/platform/observability/logger.js';
import { assertPackageNameMatchesExportedName } from '@/platform/utils/package-manifest.js';
import { discoverPluginsByPrefix, type DiscoveredPlugin } from '@/platform/utils/plugin-discovery.js';
import { hasCanonicalValueChanged } from '@/platform/utils/canonical-stringify.js';
import type { ChannelPlugin } from './channel-plugin.js';
import { ChannelPluginManager } from './channel-manager.js';

export interface ChannelRuntimeConfigSource {
  getChannelsConfig(): Record<string, unknown>;
  onChannelsConfigChange(
    listener: (next: Record<string, unknown>, previous: Record<string, unknown>) => Promise<void>
  ): () => void;
  syncDefaultConfigs(): Promise<void>;
}

interface ChannelRuntimeDependencies {
  channelManager: ChannelPluginManager;
  configSource: ChannelRuntimeConfigSource;
  getPipeline: () => ChannelPipeline | null;
}

export class ChannelRuntime {
  private configChangeUnsubscribe: (() => void) | null = null;
  private hotReloadEnabled = false;

  constructor(private readonly deps: ChannelRuntimeDependencies) {}

  getChannelCount(): number {
    return this.deps.channelManager.getChannelCount();
  }

  async start(options: { watchConfig?: boolean } = {}): Promise<void> {
    const { watchConfig = true } = options;

    await this.loadChannelPlugins(this.deps.configSource.getChannelsConfig());
    if (watchConfig) {
      this.watchConfigChanges();
    }
  }

  watchConfigChanges(): void {
    this.registerConfigChangeListener();
  }

  async stop(): Promise<void> {
    this.configChangeUnsubscribe?.();
    this.configChangeUnsubscribe = null;
    this.hotReloadEnabled = false;
    await this.deps.channelManager.shutdown();
  }

  private async loadChannelPlugins(channels: Record<string, unknown>): Promise<void> {
    const pipeline = this.deps.getPipeline();
    if (!pipeline) {
      logger.error({}, 'Pipeline not initialized, cannot load channel plugins');
      return;
    }

    this.deps.channelManager.setPipeline(pipeline);

    const pluginsDir = path.join(process.cwd(), 'plugins');
    for (const discovered of discoverPluginsByPrefix(pluginsDir, 'channel_')) {
      await this.loadChannelPluginEntry(discovered, channels);
    }

    logger.info({ loadedChannels: this.deps.channelManager.getChannelCount() }, 'Channel system initialized');
  }

  private async loadChannelPluginEntry(
    discovered: DiscoveredPlugin,
    channels: Record<string, unknown>
  ): Promise<void> {
    const pluginName = discovered.dirName;

    try {
      const entryPath = this.resolveChannelEntry(discovered);
      if (!entryPath) {
        logger.warn({ pluginName }, 'Channel plugin entry point not found');
        return;
      }

      const { default: channelPlugin } = await import(pathToFileURL(entryPath).href) as {
        default: ChannelPlugin;
      };

      assertPackageNameMatchesExportedName(discovered.packageJson, channelPlugin.name, 'Channel plugin');

      const channelConfig = (channels[channelPlugin.name] as Record<string, unknown> | undefined) || {};
      await this.deps.channelManager.registerChannel(channelPlugin, channelConfig);
      logger.info({ channelName: channelPlugin.name }, `${channelPlugin.name} channel plugin loaded`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({ error: errorMessage, stack: errorStack, pluginName }, 'Failed to load channel plugin');
    }
  }

  private resolveChannelEntry(discovered: DiscoveredPlugin): string | undefined {
    const mainFile = discovered.packageJson.main || 'dist/index.js';
    const candidates = [
      path.join(discovered.dir, mainFile),
      path.join(discovered.dir, 'index.ts'),
      path.join(discovered.dir, 'src/index.ts'),
    ];

    return candidates.find(candidate => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });
  }

  private registerConfigChangeListener(): void {
    this.configChangeUnsubscribe?.();
    this.configChangeUnsubscribe = null;
    this.hotReloadEnabled = false;

    this.configChangeUnsubscribe = this.deps.configSource.onChannelsConfigChange(
      async (nextChannels, previousChannels) => {
        if (!this.hotReloadEnabled) {
          return;
        }
        if (!hasCanonicalValueChanged(previousChannels, nextChannels)) {
          return;
        }

        logger.info({}, 'Channel config changed, reloading channel plugins');
        await this.deps.channelManager.shutdown();
        await this.loadChannelPlugins(nextChannels);

        this.hotReloadEnabled = false;
        try {
          await this.deps.configSource.syncDefaultConfigs();
        } finally {
          this.hotReloadEnabled = true;
        }
      }
    );

    this.hotReloadEnabled = true;
  }
}
