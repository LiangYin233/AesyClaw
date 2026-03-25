import { randomUUID } from 'crypto';
import type { AgentRuntime } from '../../agent/index.js';
import { ValidationError } from '../../api/errors.js';

const WEBUI_CHANNEL = 'webui';

export class ChatApiService {
  constructor(
    private readonly agentRuntime: Pick<AgentRuntime, 'handleDirect'>,
    private readonly maxMessageLength: number
  ) {}

  async createChatResponse(request: {
    sessionKey?: string;
    message: string;
    channel?: string;
    chatId?: string;
  }): Promise<{
    success: true;
    response: unknown;
  }> {
    const message = this.validateMessage(request.message);
    const channel = this.validateOptionalString(request.channel, 'channel');
    const chatId = this.validateOptionalString(request.chatId, 'chatId');
    const sessionKey = this.validateOptionalString(request.sessionKey, 'sessionKey');
    const resolvedChannel = channel || WEBUI_CHANNEL;
    const key = sessionKey || `${resolvedChannel}:${randomUUID()}`;
    const resolvedChatId = chatId || sessionKey || key;
    const response = await this.agentRuntime.handleDirect(message, {
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

  private validateOptionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw new ValidationError(`${field} must be a string`, field);
    }
    return value.trim() || undefined;
  }
}
