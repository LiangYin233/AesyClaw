/**
 * 精简管道的类型定义。
 */

import type { IHooksBus } from '@aesyclaw/hook';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { SessionManager } from '@aesyclaw/session';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { AgentRegistry } from '@aesyclaw/agent/agent-registry';

// ─── 管道依赖 ───────────────────────────────────────────────

/** Agent 处理所需的服务集合 (用于 Pipeline 的 LLM 交互阶段) */
export type AgentProcessingServices = {
  llmAdapter: LlmAdapter;
  roleManager: RoleManager;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  hooksBus: IHooksBus;
  compressionThreshold: number;
  agentRegistry: AgentRegistry;
};

/** 基础设施服务集合 (用于 Pipeline 的接收/派发阶段) */
export type InfrastructureServices = {
  sessionManager: SessionManager;
  commandRegistry: CommandRegistry;
  databaseManager: DatabaseManager;
};

/** 初始化时注入 Pipeline 的依赖 */
export type PipelineDependencies = InfrastructureServices & AgentProcessingServices;
