import { requireObjectBody, requireString } from '../../shared/requestParsers.js';

export interface SendChannelMessageDto {
  chatId: string;
  content: string;
}

export function parseSendChannelMessage(body: unknown): SendChannelMessageDto {
  const payload = requireObjectBody(body);

  return {
    chatId: requireString(payload.chatId, 'chatId', 'chatId is required and must be a string'),
    content: requireString(payload.content, 'content', 'content is required and must be a string')
  };
}
