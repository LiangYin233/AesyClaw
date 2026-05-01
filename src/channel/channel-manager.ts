/** 频道管理器 — 初始化频道适配器并将消息桥接到管道中。 */

import type { InboundMessage, OutboundMessage, SendFn, SessionKey } from '../core/types';
import { createScopedLogger } from '../core/logger';
import { BaseManager } from '../core/base-manager';
import { errorMessage, mergeDefaults } from '../core/utils';
import { SerialExecutor } from '../utils/serial-executor';
import { ChannelLoader } from './channel-loader';
import type {
  ChannelContext,
  ChannelManagerDependencies,
  ChannelPlugin,
  ChannelStatus,
  LoadedChannel,
} from './channel-types';
import { isChannelEnabled, isRecord } from './channel-types';

const logger = createScopedLogger('channel-manager');

export class ChannelManager extends BaseManager<ChannelManagerDependencies> {
  private readonly definitions = new Map<string, ChannelPlugin>();
  private readonly loadedChannels = new Map<string, LoadedChannel>();
  private readonly failedChannels = new Map<string, string>();
  private readonly channelOwners = new Map<string, string>();
  private serialExecutor = new SerialExecutor();

  initialize(dependencies: ChannelManagerDependencies): void {
    super.initialize(dependencies);
    for (const channel of this.definitions.values()) {
      this.registerDefaults(channel);
    }
    for (const channel of dependencies.channels ?? []) {
      this.register(channel);
    }
  }

  register(channel: ChannelPlugin, owner?: string): void {
    const existing = this.definitions.get(channel.name);
    if (existing && existing !== channel) {
      throw new Error(`频道 "${channel.name}" 已注册`);
    }

    this.definitions.set(channel.name, channel);
    this.registerDefaults(channel);
    if (owner) {
      this.channelOwners.set(channel.name, owner);
    }
    logger.debug('频道已注册', { channel: channel.name });
  }

  has(channelName: string): boolean {
    return this.definitions.has(channelName);
  }

  async unregister(channelName: string): Promise<void> {
    await this.stop(channelName);
    this.definitions.delete(channelName);
    this.failedChannels.delete(channelName);
    this.channelOwners.delete(channelName);
    logger.debug('频道已注销', { channel: channelName });
  }

  async unregisterByOwner(owner: string): Promise<void> {
    for (const [channelName, channelOwner] of this.channelOwners) {
      if (channelOwner === owner) {
        await this.unregister(channelName);
      }
    }
  }

  async startAll(): Promise<void> {
    this.assertInitialized();
    for (const channel of this.definitions.values()) {
      if (!this.isEnabled(channel.name)) {
        this.failedChannels.delete(channel.name);
        logger.info('跳过已禁用的频道', { channel: channel.name });
        continue;
      }

      try {
        await this.start(channel.name);
      } catch (err) {
        this.failedChannels.set(channel.name, errorMessage(err));
        logger.error(`频道 "${channel.name}" 启动失败`, err);
      }
    }
  }

  async stopAll(): Promise<void> {
    const names = [...this.loadedChannels.keys()].reverse();
    for (const name of names) {
      try {
        await this.stop(name);
      } catch (err) {
        logger.error(`频道 "${name}" 停止失败`, err);
      }
    }
    logger.info('所有频道已停止');
  }

  async start(channelName: string): Promise<LoadedChannel> {
    this.assertInitialized();
    const definition = this.definitions.get(channelName);
    if (!definition) {
      throw new Error(`频道 "${channelName}" 未注册`);
    }

    if (this.loadedChannels.has(channelName)) {
      await this.stop(channelName);
    }

    const config = this.getMergedConfig(definition);
    if (!isChannelEnabled(config)) {
      return this.createUnloadedChannel(definition, config);
    }

    const context = this.createContext(definition.name, config);
    await definition.init(context);

    const loaded: LoadedChannel = {
      definition,
      config,
      loadedAt: new Date(),
    };
    this.loadedChannels.set(definition.name, loaded);
    this.failedChannels.delete(definition.name);
    logger.info('频道已启动', { channel: definition.name });
    return loaded;
  }

  async stop(channelName: string): Promise<void> {
    const loaded = this.loadedChannels.get(channelName);
    if (!loaded) {
      return;
    }

    try {
      if (loaded.definition.destroy) {
        await loaded.definition.destroy();
      }
    } finally {
      this.loadedChannels.delete(channelName);
      this.failedChannels.delete(channelName);
      logger.info('频道已停止', { channel: channelName });
    }
  }

  async send(sessionKey: SessionKey, message: OutboundMessage): Promise<void> {
    const loaded = this.loadedChannels.get(sessionKey.channel);
    if (!loaded) {
      throw new Error(`频道 "${sessionKey.channel}" 未加载`);
    }
    if (!loaded.definition.send) {
      throw new Error(`频道 "${sessionKey.channel}" 不支持出站发送`);
    }
    await loaded.definition.send(sessionKey, message);
  }

  async handleConfigReload(): Promise<void> {
    return await this.serialExecutor.execute(async () => {
      await this.stopAll();
      await this.startAll();
    }, '频道配置重载');
  }

  listChannels(): ChannelStatus[] {
    const statuses: ChannelStatus[] = [];
    for (const definition of this.definitions.values()) {
      const enabled = this.isEnabled(definition.name);
      const error = this.failedChannels.get(definition.name);
      statuses.push({
        name: definition.name,
        version: definition.version,
        description: definition.description,
        enabled,
        state: error
          ? 'failed'
          : this.loadedChannels.has(definition.name)
            ? 'loaded'
            : enabled
              ? 'unloaded'
              : 'disabled',
        error,
      });
    }
    return statuses.sort((a, b) => a.name.localeCompare(b.name));
  }

  async registerFromDisk(extensionsDir: string): Promise<void> {
    const loader = new ChannelLoader({ extensionsDir });
    const dirs = await loader.discover();
    for (const dir of dirs) {
      try {
        const mod = await loader.load(dir);
        this.register(mod.definition, 'disk');
      } catch (err) {
        logger.error(`频道扩展 "${dir}" 加载失败`, err);
      }
    }
  }

  getLoaded(channelName: string): LoadedChannel | undefined {
    return this.loadedChannels.get(channelName);
  }

  /** 获取所有已注册的频道定义及其元数据。 */
  getRegisteredChannels(): Array<{
    name: string;
    version: string;
    description?: string;
    defaultConfig?: Record<string, unknown>;
  }> {
    return [...this.definitions.values()].map((def) => ({
      name: def.name,
      version: def.version,
      description: def.description,
      defaultConfig: def.defaultConfig,
    }));
  }

  private createContext(channelName: string, config: Record<string, unknown>): ChannelContext {
    return {
      name: channelName,
      config,
      receiveWithSend: async (message: InboundMessage, send: SendFn): Promise<void> => {
        const pipeline = this.getDeps().pipeline;
        await pipeline.receiveWithSend(message, send);
      },
      logger: createScopedLogger(`channel:${channelName}`),
    };
  }

  private registerDefaults(channel: ChannelPlugin): void {
    if (!this.deps || !channel.defaultConfig) {
      return;
    }
    this.deps.configManager.registerDefaults(`channels.${channel.name}`, channel.defaultConfig);
  }

  private getMergedConfig(definition: ChannelPlugin): Record<string, unknown> {
    const channelConfig = this.getConfigRecord(definition.name);
    return mergeDefaults(definition.defaultConfig ?? {}, channelConfig);
  }

  private getConfigRecord(channelName: string): Record<string, unknown> {
    const configManager = this.getDeps().configManager;
    try {
      const channels = configManager.get('channels');
      const config = channels[channelName];
      return isRecord(config) ? config : {};
    } catch {
      return {};
    }
  }

  private isEnabled(channelName: string): boolean {
    return isChannelEnabled(this.getConfigRecord(channelName));
  }

  private createUnloadedChannel(
    definition: ChannelPlugin,
    config: Record<string, unknown>,
  ): LoadedChannel {
    return {
      definition,
      config,
      loadedAt: new Date(),
    };
  }

}
