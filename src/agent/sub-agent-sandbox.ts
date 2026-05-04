/**
 * SubAgentSandbox — 隔离的子 Agent 执行环境。
 *
 * 使用临时内存历史执行委托轮次，使调用者的
 * 持久化会话记录不会被更改。
 *
 */

import { randomUUID } from 'node:crypto';
import type { RoleConfig, SessionKey, PersistableMessage } from '@aesyclaw/core/types';
import { MemoryManager } from './memory-manager';
import type { MessagesRepository } from '@aesyclaw/core/database/database-manager';
import type { SubAgentRoleParams, SubAgentTempParams } from './agent-types';
import type { AgentEngine } from './agent-engine';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { ToolExecutionContext } from '@aesyclaw/tool/tool-registry';
import type { LlmAdapter } from './llm-adapter';

// ─── 依赖 ───────────────────────────────────────────────

/**
 * SubAgentSandbox 的依赖。
 *
 * 将在 Pi-mono Agent 集成可用时扩展。
 */
export type SubAgentSandboxDependencies = {
  agentEngine: Pick<AgentEngine, 'runAgentTurn'>;
  roleManager: Pick<RoleManager, 'getRole' | 'getDefaultRole'>;
  llmAdapter: Pick<LlmAdapter, 'resolveModel'>;
};

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

    return await this.execute(
      this.applyToolOverride(role, params),
      params.prompt,
      executionContext,
    );
  }

  private async execute(
    role: RoleConfig,
    prompt: string,
    executionContext?: Pick<ToolExecutionContext, 'sessionKey' | 'sendMessage'>,
  ): Promise<string> {
    const sessionId = `sub-agent:${randomUUID()}`;
    const resolvedModel = this.deps.llmAdapter.resolveModel(role.model);
    const memory = new MemoryManager(sessionId, new InMemoryMessageRepository(), {
      maxContextTokens: resolvedModel.contextWindow,
      compressionThreshold: 0.8,
    });
    const sessionKey = executionContext?.sessionKey ?? EMPTY_SESSION_KEY;

    const result = await this.deps.agentEngine.runAgentTurn({
      role,
      content: prompt,
      history: [],
      sessionKey,
      sendMessage: executionContext?.sendMessage,
    });

    await memory.syncFromAgent(result.newMessages);
    return result.lastAssistant ?? '[子 Agent 无输出]';
  }

  private applyToolOverride(
    role: RoleConfig,
    params: Pick<SubAgentRoleParams | SubAgentTempParams, 'enableTools'>,
  ): RoleConfig {
    // 如果调用者选择禁用所有工具，则直接返回空允许列表
    if (params.enableTools === false) {
      return { ...role, toolPermission: { mode: 'allowlist', list: [] } };
    }

    const { mode, list } = role.toolPermission;
    const blockedTools = ['run_sub_agent', 'run_temp_sub_agent'];

    // 对于允许列表模式：通配符 '*' 无法通过名称过滤去除，
    // 需要转换为拒绝列表；其余情况直接过滤禁止的工具名称
    if (mode === 'allowlist') {
      return list.includes('*')
        ? { ...role, toolPermission: { mode: 'denylist' as const, list: blockedTools } }
        : {
            ...role,
            toolPermission: {
              mode: 'allowlist' as const,
              list: list.filter((name) => !blockedTools.includes(name)),
            },
          };
    }

    // 拒绝列表模式：追加禁止的工具
    return {
      ...role,
      toolPermission: {
        mode: 'denylist' as const,
        list: [...new Set([...list, ...blockedTools])],
      },
    };
  }
}

class InMemoryMessageRepository implements MessagesRepository {
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
