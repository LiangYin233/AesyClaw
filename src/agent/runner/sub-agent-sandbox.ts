/**
 * SubAgentSandbox — 隔离的子 Agent 执行环境。
 *
 * 通过 runAgentTurn 以空历史执行委托轮次，复用主 Agent 的 Worker 机制。
 */

import { randomUUID } from 'node:crypto';
import type { RoleConfig, SessionKey } from '@aesyclaw/core/types';
import type { SubAgentRoleParams, SubAgentTempParams } from '../agent-types';
import type { AgentEngine } from '../agent-engine';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { ToolExecutionContext } from '@aesyclaw/tool/tool-registry';

export type SubAgentSandboxDependencies = {
  agentEngine: Pick<AgentEngine, 'runAgentTurn'>;
  roleManager: Pick<RoleManager, 'getRole' | 'getDefaultRole'>;
};

export class SubAgentSandbox {
  constructor(private readonly deps: SubAgentSandboxDependencies) {}

  async runWithRole(
    params: SubAgentRoleParams,
    executionContext?: Pick<ToolExecutionContext, 'sessionKey' | 'sendMessage'>,
  ): Promise<string> {
    const role = this.applyToolOverride(this.deps.roleManager.getRole(params.roleId), params);
    return await this.execute(role, params.prompt, executionContext);
  }

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
    const result = await this.deps.agentEngine.runAgentTurn({
      role,
      content: prompt,
      history: [],
      sessionKey: executionContext?.sessionKey ?? EMPTY_SESSION_KEY,
      sendMessage: executionContext?.sendMessage,
    });

    return result.lastAssistant ?? '[子 Agent 无输出]';
  }

  private applyToolOverride(
    role: RoleConfig,
    params: Pick<SubAgentRoleParams | SubAgentTempParams, 'enableTools'>,
  ): RoleConfig {
    if (params.enableTools === false) {
      return { ...role, toolPermission: { mode: 'allowlist', list: [] } };
    }

    const { mode, list } = role.toolPermission;
    const blockedTools = ['run_sub_agent', 'run_temp_sub_agent'];

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

    return {
      ...role,
      toolPermission: {
        mode: 'denylist' as const,
        list: [...new Set([...list, ...blockedTools])],
      },
    };
  }
}

const EMPTY_SESSION_KEY: SessionKey = {
  channel: 'sub-agent',
  type: 'delegated',
  chatId: 'isolated',
};
