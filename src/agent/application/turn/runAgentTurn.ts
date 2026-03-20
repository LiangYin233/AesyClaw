import type { ExecutionContext } from '../../infrastructure/execution/ExecutionTypes.js';

export interface RunAgentTurnDeps {
  executeTurn: (context: ExecutionContext) => Promise<string | undefined>;
}

export async function runAgentTurn(
  deps: RunAgentTurnDeps,
  input: ExecutionContext
): Promise<string | undefined> {
  return deps.executeTurn(input);
}
