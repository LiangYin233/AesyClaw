import type { InboundMessage } from '../../types.js';
import type { ExecutionContext } from '../execution/ExecutionTypes.js';

export interface InboundAgentContext {
  message: InboundMessage;
  suppressOutbound?: boolean;
}

export type TurnContext = ExecutionContext;
