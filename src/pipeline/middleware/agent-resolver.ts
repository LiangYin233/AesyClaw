/**
 * Agent 解析 — 从已解析的 Session 创建 Agent 并解析活跃角色。
 *
 * 在 session-resolver 之后运行。使用 Session 中的 activeRoleId
 * 解析角色，然后创建 Agent 实例。
 */

import type { PipelineState } from './types';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import { Agent } from '@aesyclaw/agent/agent';

export async function agentResolver(
  state: PipelineState,
  roleManager: RoleManager,
  skillManager: SkillManager,
  databaseManager: DatabaseManager,
  llmAdapter: LlmAdapter,
  toolRegistry: ToolRegistry,
  hookDispatcher: HookDispatcher,
): Promise<PipelineState> {
  if (state.stage !== 'continue') return state;
  if (!state.session) return state;

  const session = state.session;

  const activeRoleId =
    session.activeRoleId ??
    (await databaseManager.roleBindings.getActiveRole(session.sessionId)) ??
    undefined;

  const activeRole = activeRoleId
    ? roleManager.getRole(activeRoleId)
    : roleManager.getDefaultRole();

  session.setActiveRoleId(activeRole.id);

  const agent = new Agent({
    session,
    llmAdapter,
    roleManager,
    skillManager,
    toolRegistry,
    hookDispatcher,
  });
  await agent.setRole(activeRole);

  if (session.modelOverride) {
    agent.setModel(session.modelOverride);
  }

  return { ...state, agent, activeRole };
}
