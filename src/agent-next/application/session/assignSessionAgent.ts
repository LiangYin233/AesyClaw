export class AgentRoleNotFoundError extends Error {
  constructor(agentName: string) {
    super(`Agent role not found: ${agentName}`);
    this.name = 'AgentRoleNotFoundError';
  }
}

export interface AssignSessionAgentInput {
  sessionKey: string;
  agentName: string | null;
}

export interface AssignSessionAgentResult {
  success: true;
  agentName: string;
}

export interface AssignSessionAgentDeps {
  getDefaultRoleName: () => string;
  getSession: (sessionKey: string) => Promise<{ key: string; channel: string; chatId: string }>;
  getResolvedRole: (agentName: string) => { name: string } | null;
  clearConversationAgent: (channel: string, chatId: string) => void;
  setConversationAgent: (channel: string, chatId: string, agentName: string) => void;
}

export async function assignSessionAgent(
  deps: AssignSessionAgentDeps,
  input: AssignSessionAgentInput
): Promise<AssignSessionAgentResult> {
  if (input.agentName === null || input.agentName === '') {
    const session = await deps.getSession(input.sessionKey);
    deps.clearConversationAgent(session.channel, session.chatId);
    return {
      success: true,
      agentName: deps.getDefaultRoleName()
    };
  }

  const role = deps.getResolvedRole(input.agentName);
  if (!role) {
    throw new AgentRoleNotFoundError(input.agentName);
  }

  const session = await deps.getSession(input.sessionKey);
  deps.setConversationAgent(session.channel, session.chatId, role.name);
  return {
    success: true,
    agentName: role.name
  };
}
