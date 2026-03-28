import type { AgentRoleService } from '../../../agent/infrastructure/roles/AgentRoleService.js';
import type { ISessionRouting } from '../../../agent/domain/session.js';
import type { AgentRoleConfig } from '../../../types.js';
import { ServiceUnavailableError } from '../../../platform/errors/index.js';

export class AgentRepository {
  constructor(
    private readonly sessionRouting: ISessionRouting,
    private readonly agentRoleService?: AgentRoleService
  ) {}

  list() {
    if (!this.agentRoleService) {
      return [];
    }
    return this.agentRoleService.listResolvedRoles();
  }

  async create(input: AgentRoleConfig) {
    return this.requireService().createRole(input);
  }

  async update(name: string, input: Partial<AgentRoleConfig>) {
    return this.requireService().updateRole(name, input);
  }

  async delete(name: string): Promise<void> {
    await this.requireService().deleteRole(name);
    this.sessionRouting.deleteAgentBindings(name);
  }

  private requireService(): AgentRoleService {
    if (!this.agentRoleService) {
      throw new ServiceUnavailableError('Agent role service unavailable');
    }
    return this.agentRoleService;
  }
}
