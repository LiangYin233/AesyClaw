import type { ExecutionContext } from '../../legacy-execution/ExecutionTypes.js';

export interface RunAgentTurnDeps {
  executeTurn: (context: ExecutionContext) => Promise<string | undefined>;
}
