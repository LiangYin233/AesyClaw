import { NotFoundError, ValidationError } from '../../api/errors.js';
import { ChannelRepository } from './ChannelRepository.js';
import { buildChannelStatusSnapshot } from './channelStatus.js';

export class ChannelApiService {
  constructor(
    private readonly channelRepository: ChannelRepository,
    private readonly maxMessageLength: number
  ) {}

  getChannelStatus(): Record<string, { running?: boolean; enabled?: boolean; connected?: boolean }> {
    return buildChannelStatusSnapshot(this.channelRepository);
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

    const channelInstance = this.channelRepository.getChannel(name);
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
