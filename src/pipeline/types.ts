/**
 * 精简管道的类型定义。
 *
 * 统一使用 PipeCtx 作为所有管道钩子的共享上下文。
 */

import type {
  Message,
  PipelineResult,
  SessionKey,
  SenderInfo,
  RoleConfig,
} from '@aesyclaw/core/types';
import type { Session } from '@aesyclaw/session';
import type { Agent } from '@aesyclaw/agent/agent';
import type {
  BeforeToolCallHookContext,
  BeforeToolCallHookResult,
  AfterToolCallHookContext,
  AfterToolCallHookResult,
} from '@aesyclaw/agent/agent-types';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { SessionManager } from '@aesyclaw/session';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { AgentRegistry } from '@aesyclaw/agent/agent-registry';

// ─── 统一管道上下文 ───────────────────────────────────────────

/**
 * 统一管道钩子上下文，所有管道钩子共享。
 *
 * onReceive 阶段：message/sessionKey/sender 可用
 * beforeLLM 阶段：session/agent/role 均已解析
 */
export type PipeCtx = {
  message: Message;
  sessionKey: SessionKey;
  sender?: SenderInfo;
  session?: Session;
  agent?: Agent;
  role?: RoleConfig;
};

/**
 * onSend 专属上下文，出站消息投递前使用。
 */
export type SendCtx = {
  message: Message;
  sessionKey?: SessionKey;
};

// ─── 插件钩子 ────────────────────────────────────────────────

/**
 * 插件可以向 Pipeline 注册的钩子。
 *
 * 所有钩子均为可选，使用统一 PipeCtx 上下文：
 * - onReceive: 消息进入管道后的第一步
 * - beforeLLM: Agent 处理前（session/agent/role 已就绪）
 * - beforeToolCall: 工具执行前（由 ToolAdapter 调度）
 * - afterToolCall: 工具执行后
 * - onSend: 出站消息发送前
 */
export type PluginHooks = {
  onReceive?(ctx: PipeCtx): Promise<PipelineResult>;
  onSend?(ctx: SendCtx): Promise<PipelineResult>;
  beforeLLM?(ctx: PipeCtx): Promise<PipelineResult>;
  beforeToolCall?(ctx: BeforeToolCallHookContext): Promise<BeforeToolCallHookResult>;
  afterToolCall?(ctx: AfterToolCallHookContext): Promise<AfterToolCallHookResult>;
};

// ─── 管道依赖 ───────────────────────────────────────────────

/** Agent 处理所需的服务集合 (用于 Pipeline 的 LLM 交互阶段) */
export type AgentProcessingServices = {
  llmAdapter: LlmAdapter;
  roleManager: RoleManager;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
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
