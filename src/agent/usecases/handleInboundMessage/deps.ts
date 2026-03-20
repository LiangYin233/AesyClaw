import type { ToolContext } from '../../../tools/ToolRegistry.js';
import type { InboundMessage } from '../../../types.js';
import type { PipelineResult } from '../../runtime/AgentPipeline.js';
import type { ExecutionContext } from '../../execution/ExecutionTypes.js';

export interface HandleInboundMessageDeps {
  logInbound: (message: InboundMessage) => void;
  processInbound: (input: {
    message: InboundMessage;
    suppressOutbound?: boolean;
  }) => Promise<PipelineResult>;
  resolveTurnContext: (input: {
    message: InboundMessage;
    suppressOutbound?: boolean;
    toolContextBase: ToolContext;
  }) => Promise<ExecutionContext>;
  runTurn: (context: ExecutionContext) => Promise<string | undefined>;
  logCompletion: (context: ExecutionContext) => void;
}
