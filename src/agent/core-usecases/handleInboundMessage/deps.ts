import type { ToolContext } from '../../../tools/ToolRegistry.js';
import type { InboundMessage } from '../../../types.js';
import type { PipelineResult } from '../../core-runtime/AgentPipeline.js';
import type { ExecutionContext } from '../../core-execution/ExecutionTypes.js';

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
