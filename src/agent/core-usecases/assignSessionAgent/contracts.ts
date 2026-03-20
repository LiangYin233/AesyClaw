export interface AssignSessionAgentInput {
  sessionKey: string;
  agentName: string | null;
}

export interface AssignSessionAgentResult {
  success: true;
  agentName: string;
}
