import { parseOptionalString, requireObjectBody, requireString } from '../shared/requestParsers.js';

export interface CreateChatRequestDto {
  sessionKey?: string;
  message: string;
  channel?: string;
  chatId?: string;
}

export function parseCreateChatRequest(body: unknown): CreateChatRequestDto {
  const payload = requireObjectBody(body);

  return {
    sessionKey: parseOptionalString(payload.sessionKey, 'sessionKey'),
    message: requireString(payload.message, 'message', 'message is required and must be a string'),
    channel: parseOptionalString(payload.channel, 'channel'),
    chatId: parseOptionalString(payload.chatId, 'chatId')
  };
}
