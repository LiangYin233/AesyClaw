import type { IChannelPlugin, ChannelPluginContext } from './channel-plugin.js';
import type { ChannelPipeline } from '@/agent/pipeline.js';
import type { ConfigDefaultsScope } from '@/contracts/commands.js';
import { logger, createScopedLogger } from '@/platform/observability/logger.js';
import { mergeDefaultOptions } from '@/platform/utils/merge-default-options.js';

export interface ChannelConfigDefaultsStore {
  registerDefaults(scope: ConfigDefaultsScope, name: string, defaults: Record<string, unknown>): void;
}

export class ChannelPluginManager {
  private channels: Map<string, IChannelPlugin> = new Map();
  private pipeline: ChannelPipeline | null = null;
  private configStore: ChannelConfigDefaultsStore;

  constructor(configStore: ChannelConfigDefaultsStore) {
    this.configStore = configStore;
  }

  setPipeline(pipeline: ChannelPipeline): void {
    this.pipeline = pipeline;
  }

  private getPipeline(): ChannelPipeline {
    if (!this.pipeline) {
      throw new Error('Cannot register channel: pipeline not initialized');
    }

    return this.pipeline;
  }

  private mergeChannelOptions(
    plugin: IChannelPlugin,
    userConfig?: Record<string, unknown>
  ): Record<string, unknown> {
    return mergeDefaultOptions(plugin.defaultOptions || {}, userConfig);
  }

  private collectChannelDefaults(plugin: IChannelPlugin): void {
    if (plugin.defaultOptions && Object.keys(plugin.defaultOptions).length > 0) {
      this.configStore.registerDefaults('channel', plugin.name, plugin.defaultOptions);
    }
  }

  private createChannelContext(name: string, config: Record<string, unknown>): ChannelPluginContext {
    return {
      config,
      logger: createScopedLogger(name, 'channel'),
      pipeline: this.getPipeline(),
    };
  }

  async registerChannel(
    plugin: IChannelPlugin,
    config?: Record<string, unknown>
  ): Promise<void> {
    this.getPipeline();

    if (this.channels.has(plugin.name)) {
      logger.warn({ channelName: plugin.name }, 'Channel plugin already registered, skipping');
      return;
    }

    logger.info({ channelName: plugin.name, version: plugin.version }, 'Registering channel plugin');

    const mergedConfig = this.mergeChannelOptions(plugin, config);
    const ctx = this.createChannelContext(plugin.name, mergedConfig);

    try {
      await plugin.init(ctx);

      this.channels.set(plugin.name, plugin);

      this.collectChannelDefaults(plugin);

      logger.info({ channelName: plugin.name }, 'Channel plugin registered successfully');
    } catch (error) {
      try {
        await plugin.destroy();
      } catch (cleanupError) {
        logger.error({ channelName: plugin.name, error: cleanupError }, 'Channel plugin cleanup after registration failure failed');
      }
      logger.error({ channelName: plugin.name, error }, 'Failed to register channel plugin');
      throw error;
    }
  }

  async unregisterChannel(name: string): Promise<void> {
    const plugin = this.channels.get(name);
    if (!plugin) {
      logger.warn({ channelName: name }, 'Channel plugin not found, skipping unregister');
      return;
    }

    logger.info({ channelName: name }, 'Unregistering channel plugin');

    try {
      await plugin.destroy();
      logger.info({ channelName: name }, 'Channel plugin unregistered successfully');
    } catch (error) {
      logger.error({ channelName: name, error }, 'Error during channel plugin unregister');
    } finally {
      this.channels.delete(name);
    }
  }

  getChannelCount(): number {
    return this.channels.size;
  }

  async shutdown(): Promise<void> {
    logger.info({}, 'Shutting down all channel plugins');

    const unregisterPromises = Array.from(this.channels.keys()).map(name => this.unregisterChannel(name));

    await Promise.all(unregisterPromises);

    logger.info({}, 'All channel plugins shut down');
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.shutdown();
  }
}
