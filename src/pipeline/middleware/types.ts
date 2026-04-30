/**
 * 消息处理管道的类型定义。
 *
 * 管道使用顺序处理步骤。每个步骤接收
 * 当前状态并返回一个变异副本。
 */

import type { InboundMessage, OutboundMessage, SessionKey } from '../../core/types';
import type { CommandRegistry } from '../../command/command-registry';

/**
 * 传递给 onSend 钩子的上下文。
 */
export type OnSendContext = {
  message: OutboundMessage;
  sessionKey?: SessionKey;
}
import type { SessionContext, SessionManager } from '../../agent/session-manager';
import type { AgentEngine } from '../../agent/agent-engine';

// ─── 管道状态 ──────────────────────────────────────────────

/**
 * 流经管道处理步骤的状态对象。
 *
 * 每个步骤可以在传递前读取并改变状态。
 */
type PipelineState = {
  /** 进入管道的入站消息 */
  inbound: InboundMessage;
  /** 出站响应，如果由某个步骤生成 */
  outbound?: OutboundMessage;
  /** 用于工具执行的支持 onSend 的出站投递回调 */
  sendMessage?: (message: OutboundMessage) => Promise<boolean>;
  /** 为入站消息解析的会话上下文 */
  session?: SessionContext;
  /** 管道是否应停止处理 */
  blocked?: boolean;
  /** 阻止的原因，如果被阻止 */
  blockReason?: string;
}

// ─── 管道依赖 ───────────────────────────────────────

/**
 * 初始化时注入 Pipeline 的依赖。
 *
 * 遵循 DI 模式 — 所有依赖都显式传递
 * 而不是作为单例导入。
 */
type PipelineDependencies = {
  sessionManager: SessionManager;
  agentEngine: AgentEngine;
  commandRegistry: CommandRegistry;
}

// ─── 插件钩子 ────────────────────────────────────────────────

/**
 * 插件可以向 HookDispatcher 注册的钩子。
 *
 * 每个钩子在管道的特定点运行：
 * - onReceive: 处理步骤之前
 * - beforeLLMRequest: LLM 调用之前（在 Agent 处理内部）
 * - beforeToolCall: 工具执行之前
 * - afterToolCall: 工具执行之后
 * - onSend: 出站消息发送之前
 */
type PluginHooks = {
  onReceive?(message: InboundMessage): Promise<PipelineResult>;
  beforeLLMRequest?(context: unknown): Promise<PipelineResult>;
  beforeToolCall?(context: BeforeToolCallHookContext): Promise<BeforeToolCallHookResult>;
  afterToolCall?(context: AfterToolCallHookContext): Promise<AfterToolCallHookResult>;
  onSend?(context: OnSendContext): Promise<PipelineResult>;
}

// Re-export hook types from agent-types to keep PluginHooks self-contained
import type {
  BeforeToolCallHookContext,
  BeforeToolCallHookResult,
  AfterToolCallHookContext,
  AfterToolCallHookResult,
} from '../../agent/agent-types';

// Re-export PipelineResult for convenience
import type { PipelineResult } from '../../core/types';

export type { PipelineState, PipelineDependencies, PluginHooks };
