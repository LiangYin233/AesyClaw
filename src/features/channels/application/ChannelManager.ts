import type { InboundMessage, OutboundMessage } from '../../../types.js';
import type { ChannelRuntime } from '../runtime/ChannelRuntime.js';
import type { ChannelAdapter } from '../domain/adapter.js';
import type { DeliveryReceipt } from '../domain/types.js';

export interface ChannelPluginDefinition {
  pluginName: string;
  channelName: string;
  create: (config: any) => ChannelAdapter;
}

export interface ChannelHandle {
  name: string;
  send(msg: OutboundMessage): Promise<DeliveryReceipt>;
  isRunning(): boolean;
}

export interface ChannelManagerEvent {
  type: 'registered' | 'enabled' | 'disabled' | 'reconfigured' | 'started_all' | 'stopped_all';
  channelName?: string;
}

type ChannelManagerListener = (event: ChannelManagerEvent) => void | Promise<void>;

export class ChannelManager {
  #plugins = new Map<string, ChannelPluginDefinition>();
  #pluginDefaultConfigs = new Map<string, Record<string, unknown>>();
  #channels = new Map<string, ChannelAdapter>();
  #runtime: ChannelRuntime;
  #listeners = new Set<ChannelManagerListener>();

  constructor(runtime: ChannelRuntime) {
    this.#runtime = runtime;
  }

  registerPlugin(plugin: ChannelPluginDefinition): void {
    this.#plugins.set(plugin.pluginName, plugin);
  }

  registerPluginDefaultConfig(pluginName: string, config: Record<string, unknown>): void {
    this.#pluginDefaultConfigs.set(pluginName, structuredClone(config));
  }

  unregisterPlugin(pluginName: string): void {
    this.#plugins.delete(pluginName);
    this.#pluginDefaultConfigs.delete(pluginName);
  }

  getPlugin(pluginName: string): ChannelPluginDefinition | undefined {
    return this.#plugins.get(pluginName);
  }

  listPlugins(): string[] {
    return Array.from(this.#plugins.keys());
  }

  getPluginDefaultConfig(pluginName: string): Record<string, unknown> {
    const config = this.#pluginDefaultConfigs.get(pluginName);
    return config ? structuredClone(config) : {};
  }

  registerConfiguredChannel(channelName: string, config: any): boolean {
    const plugin = this.resolvePlugin(channelName);

    if (!plugin) {
      return false;
    }

    if (this.#channels.has(plugin.channelName)) {
      return true;
    }

    this.attachChannel(plugin, config);
    void this.notifyListeners({
      type: 'registered',
      channelName: plugin.channelName
    });
    return true;
  }

  async enableChannel(channelName: string, config: any): Promise<boolean> {
    const plugin = this.resolvePlugin(channelName);

    if (!plugin) {
      return false;
    }

    const existing = this.#channels.get(plugin.channelName);
    if (existing?.isRunning()) {
      return true;
    }

    const created = !existing;
    if (created) {
      this.attachChannel(plugin, config);
    }

    try {
      await this.#runtime.startAdapter(plugin.channelName);
      void this.notifyListeners({
        type: 'enabled',
        channelName: plugin.channelName
      });
      return true;
    } catch {
      if (created) {
        this.detachChannel(plugin.channelName);
      }
      return false;
    }
  }

  async disableChannel(channelName: string): Promise<boolean> {
    const channel = this.#channels.get(channelName);
    if (!channel) {
      return true;
    }

    try {
      await this.#runtime.stopAdapter(channelName);
      this.#channels.delete(channelName);
      this.#runtime.unregisterAdapter(channelName);
      void this.notifyListeners({
        type: 'disabled',
        channelName
      });
      return true;
    } catch {
      return false;
    }
  }

  async reconfigureChannel(channelName: string, config: any): Promise<boolean> {
    const plugin = this.resolvePlugin(channelName);

    if (!plugin) {
      return false;
    }

    const previousChannel = this.#channels.get(channelName);
    if (!previousChannel) {
      return config?.enabled ? this.enableChannel(channelName, config) : true;
    }

    const wasRunning = previousChannel.isRunning();

    try {
      if (wasRunning) {
        await this.#runtime.stopAdapter(channelName);
      }
      this.detachChannel(channelName);

      if (!config?.enabled) {
        return true;
      }

      this.attachChannel(plugin, config);
      await this.#runtime.startAdapter(channelName);
      void this.notifyListeners({
        type: 'reconfigured',
        channelName
      });
      return true;
    } catch {
      this.#channels.set(channelName, previousChannel);
      this.#runtime.registerAdapter(channelName, previousChannel);

      if (wasRunning) {
        try {
          await this.#runtime.startAdapter(channelName);
        } catch {}
      }
      return false;
    }
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
    await Promise.allSettled(
      channels.map(async (channel) => {
        await this.#runtime.startAdapter(channel.name);
      })
    );

    await this.#runtime.start();
    void this.notifyListeners({
      type: 'started_all'
    });
  }

  async stopAll(): Promise<void> {
    for (const channel of this.#channels.values()) {
      try {
        await this.#runtime.stopAdapter(channel.name);
      } catch {
      }
    }

    this.#runtime.stop();
    void this.notifyListeners({
      type: 'stopped_all'
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

  onStatusChange(listener: ChannelManagerListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  private resolvePlugin(channelName: string): ChannelPluginDefinition | undefined {
    return this.getPlugin(`channel_${channelName}`);
  }

  private attachChannel(plugin: ChannelPluginDefinition, config: any): ChannelAdapter {
    const channel = plugin.create(config);
    this.#channels.set(plugin.channelName, channel);
    this.#runtime.registerAdapter(plugin.channelName, channel);
    return channel;
  }

  private detachChannel(channelName: string): void {
    this.#channels.delete(channelName);
    this.#runtime.unregisterAdapter(channelName);
  }

  private async notifyListeners(event: ChannelManagerEvent): Promise<void> {
    for (const listener of this.#listeners) {
      try {
        await listener(event);
      } catch {
        // 监听器失败不应打断渠道生命周期。
      }
    }
  }
}
