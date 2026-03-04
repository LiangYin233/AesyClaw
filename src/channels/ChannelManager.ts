import type { BaseChannel } from './BaseChannel.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';

export class ChannelManager {
  private channels: Map<string, BaseChannel> = new Map();
  private eventBus: EventBus;
  private log = logger.child({ prefix: 'ChannelManager' });

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  register(channel: BaseChannel): void {
    this.channels.set(channel.name, channel);
    this.log.info(`Registered channel: ${channel.name}`);
  }

  unregister(name: string): void {
    this.channels.delete(name);
    this.log.info(`Unregistered channel: ${name}`);
  }

  get(name: string): BaseChannel | undefined {
    return this.channels.get(name);
  }

  async startAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      try {
        await channel.start();
      } catch (error) {
        this.log.error(`Failed to start channel ${channel.name}:`, error);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      try {
        await channel.stop();
      } catch (error) {
        this.log.error(`Failed to stop channel ${channel.name}:`, error);
      }
    }
  }

  getEnabledChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  getStatus(): Record<string, { running: boolean }> {
    const status: Record<string, { running: boolean }> = {};
    for (const [name, channel] of this.channels.entries()) {
      status[name] = { running: channel.isRunning() };
    }
    return status;
  }
}
