/**
 * 精简管道的类型定义。
 */

import type { IHooksBus } from '@aesyclaw/contracts/hook';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { SessionManager } from '@aesyclaw/session';
import type { RoleManager } from '@aesyclaw/role/manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm/adapter';
import type { AgentRegistry } from '@aesyclaw/agent/registry';
import type { SkillManager } from '@aesyclaw/skill/manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';

// ─── 管道依赖 ───────────────────────────────────────────────

/** 初始化时注入 Pipeline 的依赖 */
export type PipelineDependencies = {
  sessionManager: SessionManager;
  commandRegistry: CommandRegistry;
  databaseManager: DatabaseManager;
  roleManager: RoleManager;
  agentRegistry: AgentRegistry;
  hooksBus: IHooksBus;
  llmAdapter: LlmAdapter;
  compressionThreshold: number;
  agentDeps: {
    llmAdapter: LlmAdapter;
    roleManager: RoleManager;
    skillManager: SkillManager;
    toolRegistry: ToolRegistry;
    hooksBus: IHooksBus;
    compressionThreshold: number;
    defaultModel: string;
  };
};
