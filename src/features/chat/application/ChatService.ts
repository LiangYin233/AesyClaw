import { randomUUID } from 'crypto';
import { DomainValidationError } from '../../../platform/errors/domain.js';
import type { CreateChatRequestDto } from '../contracts/chat.dto.js';

const WEBUI_CHANNEL = 'webui';

interface DirectChatHandler {
  handleDirect(
    content: string,
    reference: { sessionKey?: string; channel?: string; chatId?: string; messageType?: string } | string,
    options?: { suppressOutbound?: boolean }
  ): Promise<unknown>;
}

export class ChatService {
  constructor(
    private readonly directChatHandler: DirectChatHandler,
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
    const response = await this.directChatHandler.handleDirect(message, {
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
      throw new DomainValidationError('Message is required', 'message');
    }
    if (value.length > this.maxMessageLength) {
      throw new DomainValidationError(`Message too long (max ${this.maxMessageLength} characters)`, 'message');
    }
    return value;
  }
}
