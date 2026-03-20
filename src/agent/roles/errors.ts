export class AgentRoleNotFoundError extends Error {
  constructor(agentName: string) {
    super(`Agent role with id "${agentName}" not found`);
    this.name = 'AgentRoleNotFoundError';
  }
}
