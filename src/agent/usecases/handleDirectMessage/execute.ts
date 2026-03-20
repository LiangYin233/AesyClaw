import type { InboundMessage } from '../../../types.js';
import type { HandleDirectMessageInput } from './contracts.js';
import type { HandleDirectMessageDeps } from './deps.js';

export async function handleDirectMessage(
  deps: HandleDirectMessageDeps,
  input: HandleDirectMessageInput
): Promise<string> {
  const baseMessage: InboundMessage = {
    channel: typeof input.reference === 'string' ? 'api' : input.reference.channel || 'api',
    senderId: typeof input.reference === 'string' ? 'api' : input.reference.chatId || 'api',
    chatId: typeof input.reference === 'string'
      ? input.reference
      : input.reference.chatId || input.reference.sessionKey || 'api',
    content: input.content,
    timestamp: new Date(),
    messageType: typeof input.reference === 'string' ? 'private' : input.reference.messageType,
    sessionKey: typeof input.reference === 'string' ? input.reference : input.reference.sessionKey,
    metadata: {
      suppressOutbound: input.suppressOutbound ?? true,
      directResponse: true
    }
  };

  const bound = deps.bindMessageToSession(baseMessage, input.reference);
  const result = await deps.handleInboundMessage({
    message: bound,
    suppressOutbound: input.suppressOutbound ?? true,
    toolContextBase: input.toolContextBase
  });

  return result.content || '';
}
