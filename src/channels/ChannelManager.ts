import type { BaseChannel } from './BaseChannel.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger, normalizeError } from '../logger/index.js';

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
      this.#log.warn('Channel plugin overwritten', { pluginName: plugin.pluginName });
    }
    this.#plugins.set(plugin.pluginName, plugin);
    this.#log.debug('Channel plugin registered', { pluginName: plugin.pluginName });
  }

  unregisterPlugin(pluginName: string): void {
    this.#plugins.delete(pluginName);
    this.#log.debug('Channel plugin unregistered', { pluginName });
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
      this.#log.warn('Channel plugin missing', { pluginName });
      return null;
    }

    const channel = plugin.create(config, this.#eventBus, this.#workspace);
    this.#channels.set(plugin.channelName, channel);
    this.#log.info('Channel created', { channel: plugin.channelName, pluginName });
    return channel;
  }

  register(channel: BaseChannel): void {
    this.#channels.set(channel.name, channel);
    this.#log.debug('Channel registered', { channel: channel.name });
  }

  unregister(name: string): void {
    this.#channels.delete(name);
    this.#log.debug('Channel unregistered', { channel: name });
  }

  get(name: string): BaseChannel | undefined {
    return this.#channels.get(name);
  }

  async startAll(): Promise<void> {
    const channels = Array.from(this.#channels.values());
    const results = await Promise.allSettled(
      channels.map(async (channel) => {
        const startedAt = Date.now();
        await channel.start();
        return {
          name: channel.name,
          durationMs: Date.now() - startedAt
        };
      })
    );

    let started = 0;
    let failed = 0;
    for (const [index, result] of results.entries()) {
      const channelName = channels[index]?.name || `#${index}`;
      if (result.status === 'fulfilled') {
        started++;
        this.#log.info('Channel started', {
          channel: result.value.name,
          durationMs: result.value.durationMs
        });
        continue;
      }
      failed++;
      this.#log.error('Channel start failed', {
        channel: channelName,
        error: normalizeError(result.reason)
      });
    }

    this.#log.info('Channel startup finished', {
      total: channels.length,
      started,
      failed
    });
  }

  async stopAll(): Promise<void> {
    let stopped = 0;
    let failed = 0;

    for (const channel of this.#channels.values()) {
      try {
        await channel.stop();
        stopped++;
      } catch (error) {
        failed++;
        this.#log.error('Channel stop failed', {
          channel: channel.name,
          error: normalizeError(error)
        });
      }
    }

    this.#log.info('Channel shutdown finished', {
      total: this.#channels.size,
      stopped,
      failed
    });
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
