import type { AgentTurnContext } from '../inbound/handleInboundMessage.js';

export interface RunAgentTurnDeps {
  executeTurn: (context: AgentTurnContext) => Promise<string | undefined>;
}

export async function runAgentTurn(
  deps: RunAgentTurnDeps,
  input: AgentTurnContext
): Promise<string | undefined> {
  return deps.executeTurn(input);
}
