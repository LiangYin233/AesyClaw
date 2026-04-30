/**
 * SubAgentSandbox — 隔离的子 Agent 执行环境。
 *
 * 使用临时内存历史执行委托轮次，使调用者的
 * 持久化会话记录不会被更改。
 *
 */

import { randomUUID } from 'node:crypto';
import type { PersistableMessage, RoleConfig, SessionKey } from '../core/types';
import { MemoryManager } from './memory-manager';
import type { MessageRepositoryLike } from './memory-manager';
import type { SubAgentRoleParams, SubAgentTempParams } from './agent-types';
import type { AgentEngine } from './agent-engine';
import type { RoleManager } from '../role/role-manager';
import type { ToolExecutionContext } from '../tool/tool-registry';
import type { LlmAdapter } from './llm-adapter';

// ─── 依赖 ───────────────────────────────────────────────

/**
 * SubAgentSandbox 的依赖。
 *
 * 将在 Pi-mono Agent 集成可用时扩展。
 */
export type SubAgentSandboxDependencies = {
  agentEngine: Pick<AgentEngine, 'createAgent' | 'process'>;
  roleManager: Pick<RoleManager, 'getRole' | 'getDefaultRole'>;
  llmAdapter: Pick<LlmAdapter, 'resolveModel'>;
}

// ─── SubAgentSandbox ────────────────────────────────────────────

export class SubAgentSandbox {
  constructor(private readonly deps: SubAgentSandboxDependencies) {}

  /**
   * 使用现有角色配置执行子 Agent。
   *
   * 子 Agent 使用指定角色的系统提示词、模型和
   * 工具权限，但在隔离的上下文中运行，具有自己的
   * 对话历史。
   *
   * @param params - 指定角色和提示词的参数
   * @returns 子 Agent 的回复文本
   */
  async runWithRole(
    params: SubAgentRoleParams,
    executionContext?: Pick<ToolExecutionContext, 'sessionKey' | 'sendMessage'>,
  ): Promise<string> {
    const role = this.applyToolOverride(this.deps.roleManager.getRole(params.roleId), params);
    return await this.execute(role, params.prompt, executionContext);
  }

  /**
   * 使用临时系统提示词执行子 Agent。
   *
   * 工具权限继承自调用者的角色（通过 executionContext.toolPermission）
   * 当可用时，否则回退到默认角色的权限。
   */
  async runWithPrompt(
    params: SubAgentTempParams,
    executionContext?: Pick<ToolExecutionContext, 'sessionKey' | 'sendMessage' | 'toolPermission'>,
  ): Promise<string> {
    const baseRole = this.deps.roleManager.getDefaultRole();
    const role: RoleConfig = {
      ...baseRole,
      toolPermission: executionContext?.toolPermission ?? baseRole.toolPermission,
      id: `temp-sub-agent-${randomUUID()}`,
      name: 'Temporary Sub-Agent',
      description: 'Temporary delegated agent execution',
      systemPrompt: params.systemPrompt,
      model: params.model ?? baseRole.model,
      enabled: true,
    };

    return await this.execute(this.applyToolOverride(role, params), params.prompt, executionContext);
  }

  private async execute(
    role: RoleConfig,
    prompt: string,
    executionContext?: Pick<ToolExecutionContext, 'sessionKey' | 'sendMessage'>,
  ): Promise<string> {
    const sessionId = `sub-agent:${randomUUID()}`;
    const resolvedModel = this.deps.llmAdapter.resolveModel(role.model);
    const memory = new MemoryManager(
      sessionId,
      new InMemoryMessageRepository() as unknown as MessageRepositoryLike,
      {
        maxContextTokens: resolvedModel.contextWindow,
        compressionThreshold: 0.8,
      },
    );
    const sessionKey = executionContext?.sessionKey ?? EMPTY_SESSION_KEY;
    const agent = this.deps.agentEngine.createAgent(role, sessionId, {
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

  private applyToolOverride(
    role: RoleConfig,
    params: Pick<SubAgentRoleParams | SubAgentTempParams, 'enableTools'>,
  ): RoleConfig {
    if (params.enableTools === false) {
      return {
        ...role,
        toolPermission: {
          mode: 'allowlist',
          list: [],
        },
      };
    }

    const { mode, list } = role.toolPermission;
    const blockedTools = ['run_sub_agent', 'run_temp_sub_agent'];

    // 带通配符的允许列表：切换到拒绝列表以仅排除子 Agent 工具
    if (mode === 'allowlist' && list.includes('*')) {
      return {
        ...role,
        toolPermission: { mode: 'denylist' as const, list: blockedTools },
      };
    }

    // 显式名称的允许列表：过滤掉子 Agent 工具
    if (mode === 'allowlist') {
      return {
        ...role,
        toolPermission: {
          mode: 'allowlist' as const,
          list: list.filter((name) => !blockedTools.includes(name)),
        },
      };
    }

    // 拒绝列表：将子 Agent 工具添加到拒绝列表
    return {
      ...role,
      toolPermission: {
        mode: 'denylist' as const,
        list: [...new Set([...list, ...blockedTools])],
      },
    };
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
