import type { ExecutionContext } from '../../execution/ExecutionTypes.js';

export interface RunAgentTurnDeps {
  executeTurn: (context: ExecutionContext) => Promise<string | undefined>;
}
