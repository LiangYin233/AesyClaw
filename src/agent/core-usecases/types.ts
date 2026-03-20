import type { InboundMessage } from '../../types.js';
import type { ExecutionContext } from '../core-execution/ExecutionTypes.js';

export interface InboundAgentContext {
  message: InboundMessage;
  suppressOutbound?: boolean;
}

export type TurnContext = ExecutionContext;
