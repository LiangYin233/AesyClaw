import type { ChannelPlugin, ChannelPluginContext } from './channel-plugin.js';
import type { ChannelPipeline } from '@/agent/pipeline.js';
import type { ConfigDefaultsScope } from '@/contracts/commands.js';
import { logger, createScopedLogger } from '@/platform/observability/logger.js';
import { mergeDefaultOptions } from '@/platform/utils/merge-default-options.js';

export interface ChannelConfigDefaultsStore {
  registerDefaults(scope: ConfigDefaultsScope, name: string, defaults: Record<string, unknown>): void;
}

export class ChannelPluginManager {
  private channels: Map<string, ChannelPlugin> = new Map();
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
    plugin: ChannelPlugin,
    userConfig?: Record<string, unknown>
  ): Record<string, unknown> {
    return mergeDefaultOptions(plugin.defaultOptions || {}, userConfig);
  }

  private collectChannelDefaults(plugin: ChannelPlugin): void {
    if (plugin.defaultOptions && Object.keys(plugin.defaultOptions).length > 0) {
      this.configStore.registerDefaults('channel', plugin.name, plugin.defaultOptions);
    }
  }

  private isChannelEnabled(config: Record<string, unknown>): boolean {
    return config.enabled !== false;
  }

  private createChannelContext(name: string, config: Record<string, unknown>): ChannelPluginContext {
    return {
      config,
      logger: createScopedLogger(name, 'channel'),
      pipeline: this.getPipeline(),
    };
  }

  async registerChannel(
    plugin: ChannelPlugin,
    config?: Record<string, unknown>
  ): Promise<boolean> {
    this.getPipeline();

    if (this.channels.has(plugin.name)) {
      logger.warn({ channelName: plugin.name }, 'Channel plugin already registered, skipping');
      return false;
    }

    logger.info({ channelName: plugin.name, version: plugin.version }, 'Registering channel plugin');

    const mergedConfig = this.mergeChannelOptions(plugin, config);
    this.collectChannelDefaults(plugin);

    if (!this.isChannelEnabled(mergedConfig)) {
      logger.info({ channelName: plugin.name }, 'Channel plugin disabled, skipping registration');
      return false;
    }

    const ctx = this.createChannelContext(plugin.name, mergedConfig);

    try {
      await plugin.init(ctx);

      this.channels.set(plugin.name, plugin);

      logger.info({ channelName: plugin.name }, 'Channel plugin registered successfully');
      return true;
    } catch (error) {
      let cleanupError: unknown;

      try {
        await plugin.destroy();
      } catch (destroyError) {
        logger.error({ channelName: plugin.name, error: destroyError }, 'Channel plugin cleanup after registration failure failed');
        cleanupError = destroyError;
      }

      logger.error({ channelName: plugin.name, error }, 'Failed to register channel plugin');

      if (cleanupError) {
        throw new AggregateError([cleanupError], `Channel plugin "${plugin.name}" registration cleanup failed`, { cause: error });
      }

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
    } catch (error) {
      logger.error({ channelName: name, error }, 'Error during channel plugin unregister');
      throw error;
    }

    this.channels.delete(name);
    logger.info({ channelName: name }, 'Channel plugin unregistered successfully');
  }

  getChannelCount(): number {
    return this.channels.size;
  }

  async shutdown(): Promise<void> {
    logger.info({}, 'Shutting down all channel plugins');

    const shutdownErrors: unknown[] = [];

    for (const name of Array.from(this.channels.keys())) {
      try {
        await this.unregisterChannel(name);
      } catch (error) {
        shutdownErrors.push(error);
      }
    }

    if (shutdownErrors.length === 1) {
      throw shutdownErrors[0];
    }

    if (shutdownErrors.length > 1) {
      throw new AggregateError(shutdownErrors, 'One or more channel plugins failed to shut down cleanly');
    }

    logger.info({}, 'All channel plugins shut down');
  }

}
