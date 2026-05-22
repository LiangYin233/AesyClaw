/**
 * agent-factory — Agent 工厂。
 *
 * 将 Agent 的创建逻辑从 Pipeline 中剥离，
 * Pipeline 只需依赖 AgentFactory 接口。
 */

import type { RoleConfig } from '@aesyclaw/core/types';
import type { AgentRuntimeRef } from '@aesyclaw/contracts/agent';
import type { RoleManager } from '@aesyclaw/role/manager';
import type { LlmAdapter } from './llm/adapter';
import type { SkillManager } from '@aesyclaw/skill/manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { IHooksBus } from '@aesyclaw/contracts/hook';
import { Agent, type AgentOptions } from './agent';

export type AgentFactoryDependencies = {
  llmAdapter: LlmAdapter;
  roleManager: RoleManager;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  hooksBus: IHooksBus;
  compressionThreshold: number;
  agentRegistry: AgentOptions['registry'];
};

export type AgentFactory = {
  create(session: AgentOptions['session'], role: RoleConfig): Promise<AgentRuntimeRef>;
};

export function createAgentFactory(deps: AgentFactoryDependencies): AgentFactory {
  return {
    create: async (session, role: RoleConfig): Promise<AgentRuntimeRef> => {
      const agent = new Agent({
        session,
        llmAdapter: deps.llmAdapter,
        roleManager: deps.roleManager,
        skillManager: deps.skillManager,
        toolRegistry: deps.toolRegistry,
        hooksBus: deps.hooksBus,
        compressionThreshold: deps.compressionThreshold,
        registry: deps.agentRegistry,
      });
      await agent.setRole(role);
      return agent;
    },
  };
}
