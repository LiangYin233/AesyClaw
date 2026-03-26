import { normalizeChannelError } from '../domain/errors.js';
import type { InboundMessage, OutboundMessage } from '../../../types.js';
import { logger } from '../../../platform/observability/index.js';
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

export class ChannelManager {
  #plugins = new Map<string, ChannelPluginDefinition>();
  #pluginDefaultConfigs = new Map<string, Record<string, unknown>>();
  #channels = new Map<string, ChannelAdapter>();
  #runtime: ChannelRuntime;
  #log = logger.child('ChannelManager');

  constructor(runtime: ChannelRuntime) {
    this.#runtime = runtime;
  }

  registerPlugin(plugin: ChannelPluginDefinition): void {
    if (this.#plugins.has(plugin.pluginName)) {
      this.#log.warn('渠道插件重复注册，已覆盖', { pluginName: plugin.pluginName });
    }
    this.#plugins.set(plugin.pluginName, plugin);
    this.#log.debug('渠道插件已注册', { pluginName: plugin.pluginName });
  }

  registerPluginDefaultConfig(pluginName: string, config: Record<string, unknown>): void {
    this.#pluginDefaultConfigs.set(pluginName, structuredClone(config));
  }

  unregisterPlugin(pluginName: string): void {
    this.#plugins.delete(pluginName);
    this.#pluginDefaultConfigs.delete(pluginName);
    this.#log.debug('渠道插件已注销', { pluginName });
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
      this.#log.warn('未找到渠道插件', { channelName });
      return false;
    }

    if (this.#channels.has(plugin.channelName)) {
      return true;
    }

    this.attachChannel(plugin, config);
    this.#log.debug('渠道已按配置装配', {
      channelName: plugin.channelName,
      pluginName: plugin.pluginName
    });
    return true;
  }

  async enableChannel(channelName: string, config: any): Promise<boolean> {
    const plugin = this.resolvePlugin(channelName);

    if (!plugin) {
      this.#log.warn('未找到渠道插件', { channelName });
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
      this.#log.info(created ? '渠道已创建并启动' : '渠道已启动', {
        channelName: plugin.channelName,
        pluginName: plugin.pluginName
      });
      return true;
    } catch (error) {
      if (created) {
        this.detachChannel(plugin.channelName);
      }

      this.#log.error(created ? '渠道启用失败' : '渠道启动失败', {
        channelName: plugin.channelName,
        pluginName: plugin.pluginName,
        error: normalizeChannelError(error)
      });
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
      this.#log.info('渠道已停用', { channelName });
      return true;
    } catch (error) {
      this.#log.error('渠道停用失败', {
        channelName,
        error: normalizeChannelError(error)
      });
      return false;
    }
  }

  async reconfigureChannel(channelName: string, config: any): Promise<boolean> {
    const plugin = this.resolvePlugin(channelName);

    if (!plugin) {
      this.#log.warn('未找到渠道插件', { channelName });
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
        this.#log.info('渠道配置已更新并停用', { channelName, pluginName: plugin.pluginName });
        return true;
      }

      this.attachChannel(plugin, config);
      await this.#runtime.startAdapter(channelName);
      this.#log.info('渠道配置已重载', { channelName, pluginName: plugin.pluginName });
      return true;
    } catch (error) {
      this.#channels.set(channelName, previousChannel);
      this.#runtime.registerAdapter(channelName, previousChannel);

      if (wasRunning) {
        try {
          await this.#runtime.startAdapter(channelName);
        } catch (restoreError) {
          this.#log.error('渠道配置回滚恢复失败', {
            channelName,
            pluginName: plugin.pluginName,
            error: normalizeChannelError(restoreError)
          });
        }
      }

      this.#log.error('渠道配置重载失败', {
        channelName,
        pluginName: plugin.pluginName,
        error: normalizeChannelError(error)
      });
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
        error: normalizeChannelError(result.reason)
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
          error: normalizeChannelError(error)
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
}
