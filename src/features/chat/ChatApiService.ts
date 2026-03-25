import { randomUUID } from 'crypto';
import { ValidationError } from '../../api/errors.js';
import { ChatRepository } from './ChatRepository.js';
import type { CreateChatRequestDto } from './chat.dto.js';

const WEBUI_CHANNEL = 'webui';

export class ChatApiService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly maxMessageLength: number
  ) {}

  async createChatResponse(request: CreateChatRequestDto): Promise<{
    success: true;
    response: unknown;
  }> {
    const message = this.validateMessage(request.message);
    const channel = request.channel;
    const chatId = request.chatId;
    const sessionKey = request.sessionKey;
    const resolvedChannel = channel || WEBUI_CHANNEL;
    const key = sessionKey || `${resolvedChannel}:${randomUUID()}`;
    const resolvedChatId = chatId || sessionKey || key;
    const response = await this.chatRepository.handleDirect(message, {
      sessionKey: key,
      channel: resolvedChannel,
      chatId: resolvedChatId,
      messageType: 'private'
    });

    return {
      success: true,
      response
    };
  }

  private validateMessage(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new ValidationError('Message is required', 'message');
    }
    if (value.length > this.maxMessageLength) {
      throw new ValidationError(`Message too long (max ${this.maxMessageLength} characters)`, 'message');
    }
    return value;
  }
}
