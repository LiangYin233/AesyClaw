import type { InboundMessage } from '../../../types.js';
import type { ToolContext } from '../../../tools/ToolRegistry.js';

export interface HandleInboundMessageInput {
  message: InboundMessage;
  suppressOutbound?: boolean;
  toolContextBase: ToolContext;
}

export interface HandleInboundMessageResult {
  status: 'handled' | 'replied' | 'executed';
  content?: string;
}
