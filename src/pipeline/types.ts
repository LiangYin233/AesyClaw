/**
 * 精简管道的类型定义。
 */

import type { IHooksBus } from '@aesyclaw/contracts/hook';
import type { SessionManager } from '@aesyclaw/session';
import type { RoleManager } from '@aesyclaw/role/manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { AgentRegistry } from '@aesyclaw/agent/registry';
import type { AgentFactory } from '@aesyclaw/agent/agent-factory';

// ─── 管道依赖 ───────────────────────────────────────────────

/** 初始化时注入 Pipeline 的依赖 */
export type PipelineDependencies = {
  sessionManager: SessionManager;
  databaseManager: DatabaseManager;
  roleManager: RoleManager;
  agentRegistry: AgentRegistry;
  agentFactory: AgentFactory;
  hooksBus: IHooksBus;
};
