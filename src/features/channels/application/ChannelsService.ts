import { DomainValidationError, ResourceNotFoundError } from '../../../platform/errors/domain.js';
import { ChannelRepository } from '../infrastructure/ChannelRepository.js';
import type { SendChannelMessageDto } from '../contracts/channels.dto.js';
import { buildChannelStatusSnapshot } from './channelStatusSnapshot.js';

export class ChannelsService {
  constructor(
    private readonly channelRepository: ChannelRepository,
    private readonly maxMessageLength: number
  ) {}

  getChannelStatus(): Record<string, { running?: boolean; enabled?: boolean; connected?: boolean }> {
    return buildChannelStatusSnapshot({
      runtimeStatus: this.channelRepository.getRuntimeStatus(),
      configuredChannels: this.channelRepository.getConfiguredChannels()
    });
  }

  async sendMessage(
    name: string,
    request: SendChannelMessageDto
  ): Promise<{ success: true }> {
    if (request.content.length > this.maxMessageLength) {
      throw new DomainValidationError(`content too long (max ${this.maxMessageLength} characters)`, 'content');
    }

    const channelInstance = this.channelRepository.getChannel(name);
    if (!channelInstance) {
      throw new ResourceNotFoundError('Channel', name);
    }

    await channelInstance.send({
      channel: name,
      chatId: request.chatId,
      content: request.content
    });
    return { success: true };
  }
}
