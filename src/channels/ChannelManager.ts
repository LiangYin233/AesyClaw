import type { BaseChannel } from './BaseChannel.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';

export interface ChannelPluginDefinition {
  pluginName: string;
  channelName: string;
  create: (config: any, eventBus: EventBus, workspace?: string) => BaseChannel;
}

export class ChannelManager {
  #plugins = new Map<string, ChannelPluginDefinition>();
  #channels = new Map<string, BaseChannel>();
  #eventBus: EventBus;
  #workspace: string;
  #log = logger.child({ prefix: 'ChannelManager' });

  constructor(eventBus: EventBus, workspace?: string) {
    this.#eventBus = eventBus;
    this.#workspace = workspace || process.cwd();
  }

  registerPlugin(plugin: ChannelPluginDefinition): void {
    if (this.#plugins.has(plugin.pluginName)) {
      this.#log.warn(`Channel plugin ${plugin.pluginName} already registered, overwriting`);
    }
    this.#plugins.set(plugin.pluginName, plugin);
    this.#log.debug(`Registered channel plugin: ${plugin.pluginName}`);
  }

  unregisterPlugin(pluginName: string): void {
    this.#plugins.delete(pluginName);
    this.#log.debug(`Unregistered channel plugin: ${pluginName}`);
  }

  getPlugin(pluginName: string): ChannelPluginDefinition | undefined {
    return this.#plugins.get(pluginName);
  }

  listPlugins(): string[] {
    return Array.from(this.#plugins.keys());
  }

  createChannel(name: string, config: any): BaseChannel | null {
    const pluginName = `channel_${name}`;
    const plugin = this.#plugins.get(pluginName);

    if (!plugin) {
      this.#log.warn(`Channel plugin ${pluginName} not found`);
      return null;
    }

    const channel = plugin.create(config, this.#eventBus, this.#workspace);
    this.#channels.set(plugin.channelName, channel);
    this.#log.info(`Created and registered channel: ${plugin.channelName} via ${pluginName}`);
    return channel;
  }

  register(channel: BaseChannel): void {
    this.#channels.set(channel.name, channel);
    this.#log.info(`Registered channel: ${channel.name}`);
  }

  unregister(name: string): void {
    this.#channels.delete(name);
    this.#log.info(`Unregistered channel: ${name}`);
  }

  get(name: string): BaseChannel | undefined {
    return this.#channels.get(name);
  }

  async startAll(): Promise<void> {
    for (const channel of this.#channels.values()) {
      try {
        await channel.start();
      } catch (error) {
        this.#log.error(`Failed to start channel ${channel.name}:`, error);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const channel of this.#channels.values()) {
      try {
        await channel.stop();
      } catch (error) {
        this.#log.error(`Failed to stop channel ${channel.name}:`, error);
      }
    }
  }

  getEnabledChannels(): string[] {
    return Array.from(this.#channels.keys());
  }

  getStatus(): Record<string, { running: boolean }> {
    const status: Record<string, { running: boolean }> = {};
    for (const [name, channel] of this.#channels.entries()) {
      status[name] = { running: channel.isRunning() };
    }
    return status;
  }
}
