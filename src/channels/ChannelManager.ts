import type { BaseChannel } from './BaseChannel.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';

export interface ChannelPlugin {
  name: string;
  create: (config: any, eventBus: EventBus) => BaseChannel;
}

// 静态插件注册表 - 在实例之间共享
const globalPlugins = new Map<string, ChannelPlugin>();

export class ChannelManager {
  // 使用 ES2024 私有字段
  #channels = new Map<string, BaseChannel>();
  #eventBus: EventBus;
  #log = logger.child({ prefix: 'ChannelManager' });
  static #staticLog = logger.child({ prefix: 'ChannelManager' });

  constructor(eventBus: EventBus) {
    this.#eventBus = eventBus;
  }

  // 注册通道插件 - 静态方法，可在模块加载时调用
  static registerPlugin(plugin: ChannelPlugin): void {
    if (globalPlugins.has(plugin.name)) {
      ChannelManager.#staticLog.warn(`Channel plugin ${plugin.name} already registered, overwriting`);
    }
    globalPlugins.set(plugin.name, plugin);
    ChannelManager.#staticLog.debug(`Registered channel plugin: ${plugin.name}`);
  }

  // 注销通道插件
  unregisterPlugin(name: string): void {
    globalPlugins.delete(name);
    this.#log.debug(`Unregistered channel plugin: ${name}`);
  }

  // 获取插件
  getPlugin(name: string): ChannelPlugin | undefined {
    return globalPlugins.get(name);
  }

  // 列出所有已注册的插件名称
  listPlugins(): string[] {
    return Array.from(globalPlugins.keys());
  }

  // 创建并注册通道 - 合并了原来的 Registry.createChannel + Manager.register
  createChannel(name: string, config: any): BaseChannel | null {
    const plugin = globalPlugins.get(name);
    if (!plugin) {
      this.#log.warn(`Channel plugin ${name} not found`);
      return null;
    }

    const channel = plugin.create(config, this.#eventBus);
    this.#channels.set(name, channel);
    this.#log.info(`Created and registered channel: ${name}`);
    return channel;
  }

  // 注册已存在的通道实例
  register(channel: BaseChannel): void {
    this.#channels.set(channel.name, channel);
    this.#log.info(`Registered channel: ${channel.name}`);
  }

  // 注销通道
  unregister(name: string): void {
    this.#channels.delete(name);
    this.#log.info(`Unregistered channel: ${name}`);
  }

  // 获取通道
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
