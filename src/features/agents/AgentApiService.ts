import {
  ConflictError,
  NotFoundError,
  ValidationError,
  normalizeApiError
} from '../../api/errors.js';
import type { AgentRoleConfig } from '../../types.js';
import { AgentRepository } from './AgentRepository.js';

function toAgentRoleError(error: unknown, name?: string): Error {
  const message = normalizeApiError(error);

  if (message.includes('already exists')) {
    return new ConflictError(message);
  }
  if (message.includes('not found')) {
    return new NotFoundError('Agent role', name);
  }

  return new ValidationError(message);
}

export class AgentApiService {
  constructor(private readonly agentRepository: AgentRepository) {}

  listAgents(): { agents: ReturnType<AgentRepository['list']> } {
    return { agents: this.agentRepository.list() };
  }

  async createAgent(input: AgentRoleConfig): Promise<{ agent: Awaited<ReturnType<AgentRepository['create']>> }> {
    try {
      return { agent: await this.agentRepository.create(input) };
    } catch (error) {
      throw toAgentRoleError(error);
    }
  }

  async updateAgent(name: string, input: Partial<AgentRoleConfig>): Promise<{ agent: Awaited<ReturnType<AgentRepository['update']>> }> {
    try {
      return { agent: await this.agentRepository.update(name, input) };
    } catch (error) {
      throw toAgentRoleError(error, name);
    }
  }

  async deleteAgent(name: string): Promise<{ success: true }> {
    try {
      await this.agentRepository.delete(name);
      return { success: true };
    } catch (error) {
      throw toAgentRoleError(error, name);
    }
  }
}
