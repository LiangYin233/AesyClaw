/**
 * SubAgentSandbox — isolated sub-agent execution environment.
 *
 * Executes delegated turns with temporary in-memory history so the caller's
 * persisted session transcript is not mutated.
 *
 */

import { randomUUID } from 'node:crypto';
import type { PersistableMessage, RoleConfig, SessionKey } from '../core/types';
import { DEFAULT_CONFIG } from '../core/config/defaults';
import { MemoryManager } from './memory-manager';
import type { SubAgentRoleParams, SubAgentTempParams } from './agent-types';
import type { AgentEngine } from './agent-engine';
import type { RoleManager } from '../role/role-manager';
import type { ToolExecutionContext } from '../tool/tool-registry';

// ─── Dependencies ───────────────────────────────────────────────

/**
 * Dependencies for SubAgentSandbox.
 *
 * Will be expanded when Pi-mono Agent integration is available.
 */
export interface SubAgentSandboxDependencies {
  agentEngine: Pick<AgentEngine, 'createAgent' | 'process'>;
  roleManager: Pick<RoleManager, 'getRole' | 'getDefaultRole'>;
}

// ─── SubAgentSandbox ────────────────────────────────────────────

export class SubAgentSandbox {
  constructor(private readonly deps: SubAgentSandboxDependencies) {}

  /**
   * Execute a sub-agent with an existing role configuration.
   *
   * The sub-agent uses the specified role's system prompt, model, and
   * tool permissions, but runs in an isolated context with its own
   * conversation history.
   *
 * @param params - Parameters specifying the role and prompt
 * @returns The sub-agent's response text
 */
  async runWithRole(
    params: SubAgentRoleParams,
    executionContext?: Pick<ToolExecutionContext, 'sessionKey' | 'sendMessage'>,
  ): Promise<string> {
    const role = this.deps.roleManager.getRole(params.roleId);
    return this.execute(role, params.prompt, executionContext);
  }

  /**
   * Execute a sub-agent with a temporary system prompt.
   *
   * The sub-agent uses the provided system prompt instead of a role
   * configuration, allowing ad-hoc task delegation.
   *
 * @param params - Parameters specifying the prompt and options
 * @returns The sub-agent's response text
 */
  async runWithPrompt(
    params: SubAgentTempParams,
    executionContext?: Pick<ToolExecutionContext, 'sessionKey' | 'sendMessage'>,
  ): Promise<string> {
    const baseRole = this.deps.roleManager.getDefaultRole();
    const role: RoleConfig = {
      ...baseRole,
      id: `temp-sub-agent-${randomUUID()}`,
      name: 'Temporary Sub-Agent',
      description: 'Temporary delegated agent execution',
      systemPrompt: params.systemPrompt,
      model: params.model ?? baseRole.model,
      enabled: true,
    };

    return this.execute(role, params.prompt, executionContext);
  }

  private async execute(
    role: RoleConfig,
    prompt: string,
    executionContext?: Pick<ToolExecutionContext, 'sessionKey' | 'sendMessage'>,
  ): Promise<string> {
    const sessionId = `sub-agent:${randomUUID()}`;
    const memory = new MemoryManager(
      sessionId,
      new InMemoryMessageRepository() as unknown as import('../core/database/repositories/message-repository').MessageRepository,
      DEFAULT_CONFIG.memory,
    );
    const sessionKey = executionContext?.sessionKey ?? EMPTY_SESSION_KEY;
    const agent = this.deps.agentEngine.createAgent(role, sessionId, memory, {
      sessionKey,
      sendMessage: executionContext?.sendMessage,
    });

    const outbound = await this.deps.agentEngine.process(
      agent,
      {
        sessionKey,
        content: prompt,
      },
      memory,
      role,
      executionContext?.sendMessage,
    );

    return outbound.content;
  }
}

class InMemoryMessageRepository {
  private messages: PersistableMessage[] = [];

  async save(_sessionId: string, message: PersistableMessage): Promise<void> {
    this.messages.push({ ...message });
  }

  async loadHistory(_sessionId: string): Promise<PersistableMessage[]> {
    return this.messages.map((message) => ({ ...message }));
  }

  async clearHistory(_sessionId: string): Promise<void> {
    this.messages = [];
  }

  async replaceWithSummary(_sessionId: string, summary: string): Promise<void> {
    this.messages = [
      {
        role: 'assistant',
        content: summary,
        timestamp: new Date().toISOString(),
      },
    ];
  }
}

const EMPTY_SESSION_KEY: SessionKey = {
  channel: 'sub-agent',
  type: 'delegated',
  chatId: 'isolated',
};
