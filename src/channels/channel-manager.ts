import type { IChannelPlugin, IChannelWithSend, IOutboundPayload, ChannelPluginLogger, ChannelPluginContext } from './channel-plugin.js';
import type { ChannelPipeline } from '@/agent/pipeline.js';
import { configManager } from '@/features/config/config-manager.js';
import { logger } from '@/platform/observability/logger.js';
import { isPlainObject } from '@/platform/utils/index.js';

export class ChannelPluginManager {
  private channels: Map<string, IChannelPlugin> = new Map();
  private sendFunctions: Map<string, (_payload: IOutboundPayload) => Promise<void>> = new Map();
  private pluginLogger: ChannelPluginLogger;
  private pipeline: ChannelPipeline | null = null;

  constructor() {
    this.pluginLogger = {
      info: (msg, data) => logger.info(data || {}, msg),
      warn: (msg, data) => logger.warn(data || {}, msg),
      error: (msg, data) => logger.error(data || {}, msg),
      debug: (msg, data) => logger.debug(data || {}, msg),
    };
  }

  setPipeline(pipeline: ChannelPipeline): void {
    this.pipeline = pipeline;
  }

  private mergeChannelOptions(
    plugin: IChannelPlugin,
    userConfig?: Record<string, unknown>
  ): Record<string, unknown> {
    const defaultOptions = plugin.defaultOptions || {};
    const merged = { ...defaultOptions };

    if (!userConfig) {
      return merged;
    }

    for (const key in userConfig) {
      if (Object.hasOwn(userConfig, key)) {
        const userValue = userConfig[key];
        const defaultValue = defaultOptions[key];

        if (isPlainObject(userValue) && isPlainObject(defaultValue)) {
          merged[key] = { ...defaultValue, ...userValue };
        } else {
          merged[key] = userValue;
        }
      }
    }

    return merged;
  }

  async registerChannel(
    plugin: IChannelPlugin,
    config?: Record<string, unknown>,
    sendFn?: (_payload: IOutboundPayload) => Promise<void>
  ): Promise<void> {
    if (!this.pipeline) {
      throw new Error('Cannot register channel: pipeline not initialized');
    }

    if (this.channels.has(plugin.name)) {
      logger.warn({ channelName: plugin.name }, 'Channel plugin already registered, skipping');
      return;
    }

    logger.info({ channelName: plugin.name, version: plugin.version }, 'Registering channel plugin');

    if (plugin.defaultOptions && Object.keys(plugin.defaultOptions).length > 0) {
      configManager.registerChannelDefaults(plugin.name, plugin.defaultOptions);
    }

    const mergedConfig = this.mergeChannelOptions(plugin, config);

    const ctx: ChannelPluginContext = {
      config: mergedConfig,
      logger: this.pluginLogger,
      pipeline: this.pipeline,
    };

    try {
      await plugin.init(ctx);

      this.channels.set(plugin.name, plugin);

      if (sendFn) {
        this.sendFunctions.set(plugin.name, sendFn);
      } else if ('getSendFn' in plugin) {
        this.sendFunctions.set(plugin.name, (plugin as IChannelWithSend).getSendFn());
      }

      logger.info({ channelName: plugin.name }, 'Channel plugin registered successfully');
    } catch (error) {
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
      this.channels.delete(name);
      this.sendFunctions.delete(name);
      logger.info({ channelName: name }, 'Channel plugin unregistered successfully');
    } catch (error) {
      logger.error({ channelName: name, error }, 'Error during channel plugin unregister');
    }
  }

  getSendFn(name: string): ((_payload: IOutboundPayload) => Promise<void>) | undefined {
    return this.sendFunctions.get(name);
  }

  getChannelCount(): number {
    return this.channels.size;
  }

  async shutdown(): Promise<void> {
    logger.info({}, 'Shutting down all channel plugins');

    const unregisterPromises: Promise<void>[] = [];
    for (const name of this.channels.keys()) {
      unregisterPromises.push(this.unregisterChannel(name));
    }

    await Promise.all(unregisterPromises);

    logger.info({}, 'All channel plugins shut down');
  }
}

export const channelManager = new ChannelPluginManager();
