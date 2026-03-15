import type { AgentRoleConfig } from '../../types.js';
import type { AgentRoleService as RuntimeAgentRoleService } from '../../agent/roles/AgentRoleService.js';
import type { SessionRoutingService } from '../../agent/session/SessionRoutingService.js';

export class AgentRoleService {
  constructor(
    private agentRoleService: RuntimeAgentRoleService,
    private sessionRouting: SessionRoutingService
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
    this.sessionRouting.deleteAgentBindings(name);
    return { success: true };
  }
}
