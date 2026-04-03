import type { IChannelPlugin, IChannelWithSend, IOutboundPayload, ChannelPluginLogger, ChannelPluginContext } from './channel-plugin.js';
import { logger } from '../platform/observability/logger.js';

export class ChannelPluginManager {
  private static instance: ChannelPluginManager;
  private channels: Map<string, IChannelPlugin> = new Map();
  private sendFunctions: Map<string, (payload: IOutboundPayload) => Promise<void>> = new Map();
  private pluginLogger: ChannelPluginLogger;

  private constructor() {
    this.pluginLogger = {
      info: (msg, data) => logger.info(data || {}, msg),
      warn: (msg, data) => logger.warn(data || {}, msg),
      error: (msg, data) => logger.error(data || {}, msg),
      debug: (msg, data) => logger.debug(data || {}, msg),
    };
  }

  static getInstance(): ChannelPluginManager {
    if (!ChannelPluginManager.instance) {
      ChannelPluginManager.instance = new ChannelPluginManager();
    }
    return ChannelPluginManager.instance;
  }

  static resetInstance(): void {
    if (ChannelPluginManager.instance) {
      ChannelPluginManager.instance.shutdown();
      ChannelPluginManager.instance = undefined as any;
    }
  }

  async registerChannel(
    plugin: IChannelPlugin,
    sendFn?: (payload: IOutboundPayload) => Promise<void>
  ): Promise<void> {
    if (this.channels.has(plugin.name)) {
      logger.warn({ channelName: plugin.name }, 'Channel plugin already registered, skipping');
      return;
    }

    logger.info({ channelName: plugin.name, version: plugin.version }, 'Registering channel plugin');

    const ctx: ChannelPluginContext = {
      config: {},
      logger: this.pluginLogger,
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

  getChannel(name: string): IChannelPlugin | undefined {
    return this.channels.get(name);
  }

  getSendFn(name: string): ((payload: IOutboundPayload) => Promise<void>) | undefined {
    return this.sendFunctions.get(name);
  }

  getAllChannels(): IChannelPlugin[] {
    return Array.from(this.channels.values());
  }

  getChannelCount(): number {
    return this.channels.size;
  }

  hasChannel(name: string): boolean {
    return this.channels.has(name);
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

export const channelManager = ChannelPluginManager.getInstance();
