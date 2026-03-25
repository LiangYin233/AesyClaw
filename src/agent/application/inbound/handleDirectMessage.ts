import type { ToolContext } from '../../../platform/tools/ToolRegistry.js';
import type { InboundMessage } from '../../../types.js';
import { deriveSessionReference, type SessionReference } from '../../domain/session.js';
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
  const resolvedReference = typeof input.reference === 'string'
    ? deriveSessionReference(input.reference)
    : input.reference;
  const baseMessage: InboundMessage = {
    channel: resolvedReference.channel || 'api',
    senderId: resolvedReference.chatId || 'api',
    chatId: resolvedReference.chatId || resolvedReference.sessionKey || 'api',
    content: input.content,
    timestamp: new Date(),
    messageType: resolvedReference.messageType || 'private',
    sessionKey: resolvedReference.sessionKey,
    metadata: {
      suppressOutbound: input.suppressOutbound ?? true,
      directResponse: true
    }
  };

  const bound = deps.bindMessageToSession(baseMessage, resolvedReference);
  const result = await deps.handleInboundMessage({
    message: bound,
    suppressOutbound: input.suppressOutbound ?? true,
    toolContextBase: input.toolContextBase
  });

  return result.content || '';
}
