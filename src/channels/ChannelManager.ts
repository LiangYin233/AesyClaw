import type { Database } from '../db/index.js';
import { normalizeError } from '../errors/index.js';
import type { InboundMessage, OutboundMessage } from '../types.js';
import { logger } from '../observability/index.js';
import { ChannelRuntime } from './core/runtime.js';
import type { ChannelAdapter } from './core/adapter.js';
import type { DeliveryReceipt } from './core/types.js';

export interface ChannelPluginDefinition {
  pluginName: string;
  channelName: string;
  create: (config: any, workspace?: string) => ChannelAdapter;
}

export interface ChannelHandle {
  name: string;
  send(msg: OutboundMessage): Promise<DeliveryReceipt>;
  isRunning(): boolean;
}

export class ChannelManager {
  #plugins = new Map<string, ChannelPluginDefinition>();
  #channels = new Map<string, ChannelAdapter>();
  #runtime: ChannelRuntime;
  #workspace: string;
  #log = logger.child('ChannelManager');

  constructor(db: Database, workspace?: string) {
    this.#runtime = new ChannelRuntime(db, workspace || process.cwd());
    this.#workspace = workspace || process.cwd();
  }

  registerPlugin(plugin: ChannelPluginDefinition): void {
    if (this.#plugins.has(plugin.pluginName)) {
      this.#log.warn('渠道插件重复注册，已覆盖', { pluginName: plugin.pluginName });
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

  createChannel(name: string, config: any): ChannelHandle | null {
    const pluginName = `channel_${name}`;
    const plugin = this.#plugins.get(pluginName);

    if (!plugin) {
      this.#log.warn('未找到渠道插件', { pluginName });
      return null;
    }

    const channel = plugin.create(config, this.#workspace);
    this.#channels.set(plugin.channelName, channel);
    this.#runtime.registerAdapter(plugin.channelName, channel);
    this.#log.info('渠道已创建', { channel: plugin.channelName, pluginName });
    return this.get(plugin.channelName) || null;
  }

  register(channel: ChannelAdapter): void {
    this.#channels.set(channel.name, channel);
    this.#runtime.registerAdapter(channel.name, channel);
    this.#log.debug('Channel registered', { channel: channel.name });
  }

  unregister(name: string): void {
    this.#channels.delete(name);
    this.#runtime.unregisterAdapter(name);
    this.#log.debug('Channel unregistered', { channel: name });
  }

  setInboundHandler(handler: (message: InboundMessage) => Promise<void>): void {
    this.#runtime.setInboundHandler(handler);
  }

  get(name: string): ChannelHandle | undefined {
    const channel = this.#channels.get(name);
    if (!channel) {
      return undefined;
    }

    return {
      name,
      send: async (msg: OutboundMessage) => this.dispatch({ ...msg, channel: name }),
      isRunning: () => channel.isRunning()
    };
  }

  async dispatch(message: OutboundMessage): Promise<DeliveryReceipt> {
    return this.#runtime.dispatch(message);
  }

  async startAll(): Promise<void> {
    const channels = Array.from(this.#channels.values());
    const results = await Promise.allSettled(
      channels.map(async (channel) => {
        const startedAt = Date.now();
        await this.#runtime.startAdapter(channel.name);
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
        this.#log.info('渠道已启动', {
          channel: result.value.name,
          durationMs: result.value.durationMs
        });
        continue;
      }
      failed++;
      this.#log.error('渠道启动失败', {
        channel: channelName,
        error: normalizeError(result.reason)
      });
    }

    this.#log.info('渠道启动完成', {
      total: channels.length,
      started,
      failed
    });

    await this.#runtime.start();
  }

  async stopAll(): Promise<void> {
    let stopped = 0;
    let failed = 0;

    for (const channel of this.#channels.values()) {
      try {
        await this.#runtime.stopAdapter(channel.name);
        stopped++;
      } catch (error) {
        failed++;
        this.#log.error('渠道停止失败', {
          channel: channel.name,
          error: normalizeError(error)
        });
      }
    }

    this.#runtime.stop();

    this.#log.info('渠道停止完成', {
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
