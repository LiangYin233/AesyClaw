import { AgentRoleNotFoundError } from '../../roles/errors.js';
import type { AssignSessionAgentInput, AssignSessionAgentResult } from './contracts.js';
import type { AssignSessionAgentDeps } from './deps.js';

export async function assignSessionAgent(
  deps: AssignSessionAgentDeps,
  input: AssignSessionAgentInput
): Promise<AssignSessionAgentResult> {
  if (input.agentName === null || input.agentName === '') {
    const session = await deps.getSession(input.sessionKey);
    deps.clearConversationAgent(session.channel, session.chatId);
    return { success: true, agentName: deps.getDefaultRoleName() };
  }

  const role = deps.getResolvedRole(input.agentName);
  if (!role) {
    throw new AgentRoleNotFoundError(input.agentName);
  }

  const session = await deps.getSession(input.sessionKey);
  deps.setConversationAgent(session.channel, session.chatId, role.name);
  return { success: true, agentName: role.name };
}
