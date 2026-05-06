/**
 * 会话与 Agent 解析 — 解析会话、确定活跃角色、创建 Agent。
 *
 * 为入站消息的 SessionKey 查找或创建 Session，
 * 从 DB role_bindings 表读取活跃角色，
 * 然后创建 Agent 实例并初始化角色。
 */

import type { PipelineState } from './types';
import type { SessionManager } from '@aesyclaw/session';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import { Agent } from '@aesyclaw/agent/agent';

export type SessionAgentResolverDeps = {
  sessionManager: SessionManager;
  roleManager: RoleManager;
  skillManager: SkillManager;
  databaseManager: DatabaseManager;
  llmAdapter: LlmAdapter;
  toolRegistry: ToolRegistry;
  hookDispatcher: HookDispatcher;
};

export async function sessionAgentResolver(
  state: PipelineState,
  deps: SessionAgentResolverDeps,
): Promise<PipelineState> {
  if (state.stage !== 'continue') return state;

  if (state.sessionKey.channel === 'cron' && state.sessionKey.type === 'job') {
    const existing = deps.sessionManager.get(state.sessionKey);
    if (existing) await existing.clear();
  }

  const session = await deps.sessionManager.create(state.sessionKey);

  const activeRoleId =
    (await deps.databaseManager.roleBindings.getActiveRole(session.sessionId)) ?? undefined;

  const activeRole = activeRoleId
    ? deps.roleManager.getRole(activeRoleId)
    : deps.roleManager.getDefaultRole();

  const agent = new Agent({
    session,
    llmAdapter: deps.llmAdapter,
    roleManager: deps.roleManager,
    skillManager: deps.skillManager,
    toolRegistry: deps.toolRegistry,
    hookDispatcher: deps.hookDispatcher,
  });
  await agent.setRole(activeRole);

  return { ...state, session, agent, activeRole };
}
