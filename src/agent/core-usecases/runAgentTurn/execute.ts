import type { RunAgentTurnInput } from './contracts.js';
import type { RunAgentTurnDeps } from './deps.js';

export async function runAgentTurn(
  deps: RunAgentTurnDeps,
  input: RunAgentTurnInput
): Promise<string | undefined> {
  return deps.executeTurn(input);
}
