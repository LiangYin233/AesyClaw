import type { ChannelManager } from '../../channels/ChannelManager.js';
import type { Config } from '../../types.js';
import { NotFoundError, ValidationError } from '../../api/errors.js';

export class ChannelApiService {
  constructor(
    private readonly channelManager: ChannelManager,
    private readonly getConfig: () => Config,
    private readonly maxMessageLength: number
  ) {}

  getChannelStatus(): Record<string, { running?: boolean; enabled?: boolean; connected?: boolean }> {
    const runtimeStatus = this.channelManager.getStatus();
    const configuredChannels = this.getConfig().channels;
    const merged: Record<string, { running?: boolean; enabled?: boolean; connected?: boolean }> = {};

    for (const [name, config] of Object.entries(configuredChannels)) {
      const status = runtimeStatus[name];
      const running = status?.running ?? false;
      merged[name] = {
        running,
        enabled: Boolean((config as Record<string, unknown>)?.enabled),
        connected: running
      };
    }

    for (const [name, status] of Object.entries(runtimeStatus)) {
      merged[name] = {
        enabled: merged[name]?.enabled ?? true,
        running: status.running,
        connected: status.running
      };
    }

    merged.webui = {
      running: true,
      enabled: true,
      connected: true
    };

    return merged;
  }

  async sendMessage(
    name: string,
    request: {
      chatId?: unknown;
      content?: unknown;
    }
  ): Promise<{ success: true }> {
    const chatId = this.requireString(request.chatId, 'chatId', 'chatId is required and must be a string');
    const content = this.requireString(request.content, 'content', 'content is required and must be a string');

    if (content.length > this.maxMessageLength) {
      throw new ValidationError(`content too long (max ${this.maxMessageLength} characters)`, 'content');
    }

    const channelInstance = this.channelManager.get(name);
    if (!channelInstance) {
      throw new NotFoundError('Channel', name);
    }

    await channelInstance.send({ channel: name, chatId, content });
    return { success: true };
  }

  private requireString(value: unknown, field: string, message: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new ValidationError(message, field);
    }
    return value;
  }
}
