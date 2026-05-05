/**
 * Agent 解析 — 从已解析的 Session 创建 Agent 并解析活跃角色。
 *
 * 在 session-resolver 之后运行。使用 Session 中的 activeRoleId
 * 解析角色，然后通过 AgentEngine 创建 Agent 实例。
 */

import type { PipelineState } from './types';
import type { AgentEngine } from '@aesyclaw/agent/agent-engine';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';

export async function agentResolver(
  state: PipelineState,
  agentEngine: AgentEngine,
  roleManager: RoleManager,
  databaseManager: DatabaseManager,
  llmAdapter: LlmAdapter,
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

  const agent = agentEngine.createFromSession(session, activeRole);

  if (session.modelOverride) {
    const model = llmAdapter.resolveModel(session.modelOverride);
    agent.state.model = model;
  }

  return { ...state, agent, activeRole };
}
