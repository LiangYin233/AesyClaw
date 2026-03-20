import type { ExecutionContext } from '../../core-execution/ExecutionTypes.js';

export interface RunAgentTurnDeps {
  executeTurn: (context: ExecutionContext) => Promise<string | undefined>;
}
