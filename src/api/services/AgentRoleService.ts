import type { AgentRoleConfig } from '../../types.js';
import type { AgentRoleService as RuntimeAgentRoleService } from '../../agent/roles/AgentRoleService.js';
import type { SessionManager } from '../../session/SessionManager.js';

export class AgentRoleService {
  constructor(
    private agentRoleService: RuntimeAgentRoleService,
    private sessionManager: SessionManager
  ) {}

  async listAgents() {
    return { agents: this.agentRoleService.listResolvedRoles() };
  }

  async createAgent(input: AgentRoleConfig) {
    const agent = await this.agentRoleService.createRole(input);
    return { agent };
  }

  async updateAgent(name: string, input: Partial<AgentRoleConfig>) {
    const agent = await this.agentRoleService.updateRole(name, input);
    return { agent };
  }

  async deleteAgent(name: string) {
    await this.agentRoleService.deleteRole(name);
    await this.sessionManager.deleteAgentBindings(name);
    return { success: true };
  }
}
