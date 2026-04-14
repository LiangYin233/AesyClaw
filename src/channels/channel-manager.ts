import type { IChannelPlugin, IChannelWithSend, IOutboundPayload, ChannelPluginLogger, ChannelPluginContext } from './channel-plugin.js';
import type { ChannelPipeline } from '@/agent/pipeline.js';
import { configManager } from '@/features/config/config-manager.js';
import { logger } from '@/platform/observability/logger.js';
import { mergeDefaultOptions } from '@/platform/utils/merge-default-options.js';

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

  private registerChannelDefaults(plugin: IChannelPlugin): void {
    if (plugin.defaultOptions && Object.keys(plugin.defaultOptions).length > 0) {
      configManager.registerChannelDefaults(plugin.name, plugin.defaultOptions);
    }
  }

  private createChannelContext(config: Record<string, unknown>): ChannelPluginContext {
    return {
      config,
      logger: this.pluginLogger,
      pipeline: this.getPipeline(),
    };
  }

  private resolveSendFunction(
    plugin: IChannelPlugin,
    sendFn?: (_payload: IOutboundPayload) => Promise<void>
  ): ((_payload: IOutboundPayload) => Promise<void>) | undefined {
    if (sendFn) {
      return sendFn;
    }

    if ('getSendFn' in plugin) {
      return (plugin as IChannelWithSend).getSendFn();
    }

    return undefined;
  }

  private getRegisteredChannelNames(): string[] {
    return Array.from(this.channels.keys());
  }

  async registerChannel(
    plugin: IChannelPlugin,
    config?: Record<string, unknown>,
    sendFn?: (_payload: IOutboundPayload) => Promise<void>
  ): Promise<void> {
    this.getPipeline();

    if (this.channels.has(plugin.name)) {
      logger.warn({ channelName: plugin.name }, 'Channel plugin already registered, skipping');
      return;
    }

    logger.info({ channelName: plugin.name, version: plugin.version }, 'Registering channel plugin');

    this.registerChannelDefaults(plugin);

    const mergedConfig = this.mergeChannelOptions(plugin, config);
    const ctx = this.createChannelContext(mergedConfig);

    try {
      await plugin.init(ctx);

      this.channels.set(plugin.name, plugin);

      const resolvedSendFunction = this.resolveSendFunction(plugin, sendFn);
      if (resolvedSendFunction) {
        this.sendFunctions.set(plugin.name, resolvedSendFunction);
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

    const unregisterPromises = this.getRegisteredChannelNames().map(name => this.unregisterChannel(name));

    await Promise.all(unregisterPromises);

    logger.info({}, 'All channel plugins shut down');
  }
}

export const channelManager = new ChannelPluginManager();
