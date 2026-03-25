import type { ToolContext } from '../../../platform/tools/ToolRegistry.js';
import type { InboundMessage } from '../../../types.js';
import type { ExecutionContext } from '../../infrastructure/execution/ExecutionTypes.js';

export type AgentTurnContext = ExecutionContext;

export type InboundPipelineResult =
  | { type: 'handled' }
  | { type: 'reply'; content: string }
  | { type: 'continue'; message: InboundMessage };

export interface HandleInboundMessageInput {
  message: InboundMessage;
  suppressOutbound?: boolean;
  toolContextBase: ToolContext;
}

export interface HandleInboundMessageResult {
  status: 'handled' | 'replied' | 'executed';
  content?: string;
}

export interface HandleInboundMessageDeps {
  logInbound: (message: InboundMessage) => void;
  processInbound: (input: {
    message: InboundMessage;
    suppressOutbound?: boolean;
  }) => Promise<InboundPipelineResult>;
  resolveTurnContext: (input: {
    message: InboundMessage;
    suppressOutbound?: boolean;
    toolContextBase: ToolContext;
  }) => Promise<AgentTurnContext>;
  runTurn: (context: AgentTurnContext) => Promise<string | undefined>;
  logCompletion: (context: AgentTurnContext) => void;
}

export async function handleInboundMessage(
  deps: HandleInboundMessageDeps,
  input: HandleInboundMessageInput
): Promise<HandleInboundMessageResult> {
  deps.logInbound(input.message);

  const preprocessed = await deps.processInbound({
    message: input.message,
    suppressOutbound: input.suppressOutbound
  });

  if (preprocessed.type === 'handled') {
    return { status: 'handled' };
  }

  if (preprocessed.type === 'reply') {
    return {
      status: 'replied',
      content: preprocessed.content
    };
  }

  const context = await deps.resolveTurnContext({
    message: preprocessed.message,
    suppressOutbound: input.suppressOutbound,
    toolContextBase: input.toolContextBase
  });

  const content = await deps.runTurn(context);
  deps.logCompletion(context);

  return {
    status: 'executed',
    content
  };
}
