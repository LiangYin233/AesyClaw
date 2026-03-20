import type { ToolContext } from '../../../tools/ToolRegistry.js';
import type { InboundMessage } from '../../../types.js';
import type { SessionReference } from '../../domain/session.js';
import type {
  HandleInboundMessageInput,
  HandleInboundMessageResult
} from './handleInboundMessage.js';

export interface HandleDirectMessageInput {
  content: string;
  reference: SessionReference | string;
  suppressOutbound?: boolean;
  toolContextBase: ToolContext;
}

export interface HandleDirectMessageDeps {
  bindMessageToSession: (message: InboundMessage, reference: SessionReference | string) => InboundMessage;
  handleInboundMessage: (input: HandleInboundMessageInput) => Promise<HandleInboundMessageResult>;
}

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
