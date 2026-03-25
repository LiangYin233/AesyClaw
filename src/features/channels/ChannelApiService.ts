import { NotFoundError, ValidationError } from '../../api/errors.js';
import { ChannelRepository } from './ChannelRepository.js';
import { buildChannelStatusSnapshot } from './channelStatus.js';
import type { SendChannelMessageDto } from './channels.dto.js';

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
    request: SendChannelMessageDto
  ): Promise<{ success: true }> {
    if (request.content.length > this.maxMessageLength) {
      throw new ValidationError(`content too long (max ${this.maxMessageLength} characters)`, 'content');
    }

    const channelInstance = this.channelRepository.getChannel(name);
    if (!channelInstance) {
      throw new NotFoundError('Channel', name);
    }

    await channelInstance.send({
      channel: name,
      chatId: request.chatId,
      content: request.content
    });
    return { success: true };
  }
}
