/** Channel manager — initializes channel adapters and bridges messages into the pipeline. */

import type { InboundMessage, OutboundMessage, SendFn, SessionKey } from '../core/types';
import { createScopedLogger } from '../core/logger';
import type {
  ChannelContext,
  ChannelManagerDependencies,
  ChannelPlugin,
  ChannelStatus,
  LoadedChannel,
} from './channel-types';
import { isChannelEnabled, isRecord } from './channel-types';

const logger = createScopedLogger('channel-manager');

export class ChannelManager {
  private configManager: ChannelManagerDependencies['configManager'] | null = null;
  private pipeline: ChannelManagerDependencies['pipeline'] | null = null;
  private readonly definitions = new Map<string, ChannelPlugin>();
  private readonly loadedChannels = new Map<string, LoadedChannel>();
  private readonly failedChannels = new Map<string, string>();
  private initialized = false;
  private reloading = false;

  initialize(dependencies: ChannelManagerDependencies): void {
    if (this.initialized) {
      logger.warn('ChannelManager already initialized — skipping');
      return;
    }

    this.configManager = dependencies.configManager;
    this.pipeline = dependencies.pipeline;
    for (const channel of dependencies.channels ?? []) {
      this.register(channel);
    }

    this.initialized = true;
    logger.info('ChannelManager initialized');
  }

  register(channel: ChannelPlugin): void {
    this.definitions.set(channel.name, channel);
    if (channel.defaultConfig && this.configManager?.registerDefaults) {
      this.configManager.registerDefaults(`channels.${channel.name}`, channel.defaultConfig);
    }
    logger.debug('Channel registered', { channel: channel.name });
  }

  async startAll(): Promise<void> {
    this.assertInitialized();
    for (const channel of this.definitions.values()) {
      if (!this.isEnabled(channel.name)) {
        this.failedChannels.delete(channel.name);
        logger.info('Skipping disabled channel', { channel: channel.name });
        continue;
      }

      try {
        await this.start(channel.name);
      } catch (err) {
        this.failedChannels.set(channel.name, errorMessage(err));
        logger.error(`Channel "${channel.name}" failed to start`, err);
      }
    }
  }

  async stopAll(): Promise<void> {
    const names = [...this.loadedChannels.keys()].reverse();
    for (const name of names) {
      try {
        await this.stop(name);
      } catch (err) {
        logger.error(`Channel "${name}" failed to stop`, err);
      }
    }
    logger.info('All channels stopped');
  }

  async start(channelName: string): Promise<LoadedChannel> {
    this.assertInitialized();
    const definition = this.definitions.get(channelName);
    if (!definition) {
      throw new Error(`Channel "${channelName}" is not registered`);
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
    logger.info('Channel started', { channel: definition.name });
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
      logger.info('Channel stopped', { channel: channelName });
    }
  }

  async send(sessionKey: SessionKey, message: OutboundMessage): Promise<void> {
    const loaded = this.loadedChannels.get(sessionKey.channel);
    if (!loaded) {
      throw new Error(`Channel "${sessionKey.channel}" is not loaded`);
    }
    if (!loaded.definition.send) {
      throw new Error(`Channel "${sessionKey.channel}" does not support outbound send`);
    }
    await loaded.definition.send(sessionKey, message);
  }

  async handleConfigReload(): Promise<void> {
    if (this.reloading) {
      logger.debug('Channel config reload already in progress — skipping');
      return;
    }

    this.reloading = true;
    try {
      await this.stopAll();
      await this.startAll();
    } finally {
      this.reloading = false;
    }
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
        state: error ? 'failed' : this.loadedChannels.has(definition.name) ? 'loaded' : enabled ? 'unloaded' : 'disabled',
        error,
      });
    }
    return statuses.sort((a, b) => a.name.localeCompare(b.name));
  }

  getLoaded(channelName: string): LoadedChannel | undefined {
    return this.loadedChannels.get(channelName);
  }

  private createContext(channelName: string, config: Record<string, unknown>): ChannelContext {
    return {
      name: channelName,
      config,
      receiveWithSend: async (message: InboundMessage, send: SendFn): Promise<void> => {
        if (!this.pipeline) {
          logger.error('Pipeline not initialized — cannot receive channel message');
          return;
        }
        await this.pipeline.receiveWithSend(message, send);
      },
      logger: createScopedLogger(`channel:${channelName}`),
    };
  }

  private getMergedConfig(definition: ChannelPlugin): Record<string, unknown> {
    const channelConfig = this.getConfigRecord(definition.name);
    return {
      ...(definition.defaultConfig ?? {}),
      ...channelConfig,
    };
  }

  private getConfigRecord(channelName: string): Record<string, unknown> {
    if (!this.configManager) {
      return {};
    }
    try {
      const channels = this.configManager.get('channels');
      const config = channels[channelName];
      return isRecord(config) ? config : {};
    } catch {
      return {};
    }
  }

  private isEnabled(channelName: string): boolean {
    return isChannelEnabled(this.getConfigRecord(channelName));
  }

  private createUnloadedChannel(definition: ChannelPlugin, config: Record<string, unknown>): LoadedChannel {
    return {
      definition,
      config,
      loadedAt: new Date(),
    };
  }

  private assertInitialized(): void {
    if (!this.initialized || !this.configManager || !this.pipeline) {
      throw new Error('ChannelManager not initialized');
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
