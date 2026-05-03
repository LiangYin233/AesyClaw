/**
 * 消息处理管道的类型定义。
 *
 * 管道使用顺序处理步骤。每个步骤接收
 * 当前状态并返回一个变异副本。
 */

import type {
  InboundMessage,
  OutboundMessage,
  RoleConfig,
  SessionKey,
  SenderInfo,
} from '@aesyclaw/core/types';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { SessionContext, SessionManager } from '@aesyclaw/agent/session-manager';
import type { AgentEngine } from '@aesyclaw/agent/agent-engine';
import type { Agent } from '@aesyclaw/agent/agent-types';
import type {
  BeforeToolCallHookContext,
  BeforeToolCallHookResult,
  AfterToolCallHookContext,
  AfterToolCallHookResult,
} from '@aesyclaw/agent/agent-types';
import type { PipelineResult } from '@aesyclaw/core/types';

/**
 * 传递给 onSend 钩子的上下文。
 */
export type OnSendContext = {
  message: OutboundMessage;
  sessionKey?: SessionKey;
};

/**
 * 传递给 beforeLLMRequest 钩子的上下文。
 *
 * 在 Pipeline 即将调用 Agent 处理消息前调度，
 * 钩子可阻止本次调用或直接给出响应。
 */
export type BeforeLLMRequestContext = {
  message: InboundMessage;
  sessionKey: SessionKey;
  sender?: SenderInfo;
  session: SessionContext;
  agent: Agent;
  role: RoleConfig;
};

// ─── 管道状态 ──────────────────────────────────────────────

type PipelineStateBase = {
  /** 进入管道的入站消息 */
  inbound: InboundMessage;
  /** 入站消息的会话键 */
  sessionKey: SessionKey;
  /** 入站消息的发送者信息 */
  sender?: SenderInfo;
  /** 用于工具执行的支持 onSend 的出站投递回调 */
  sendMessage?: (message: OutboundMessage) => Promise<boolean>;
};

type PipelineStateContinue = PipelineStateBase & {
  stage: 'continue';
  /** 为入站消息解析的会话上下文 */
  session?: SessionContext;
};

type PipelineStateBlocked = PipelineStateBase & {
  stage: 'blocked';
  reason: string;
};

type PipelineStateRespond = PipelineStateBase & {
  stage: 'respond';
  outbound: OutboundMessage;
  session?: SessionContext;
};

/**
 * 流经管道处理步骤的判别联合状态。
 *
 * `stage` 字段决定当前状态，TypeScript 可据此收窄类型：
 * - 'continue' — 尚无终止结果，后续步骤应继续
 * - 'blocked'  — 管道被阻止，附带原因
 * - 'respond'  — 已有出站响应，管道应终止并投递
 */
type PipelineState = PipelineStateContinue | PipelineStateBlocked | PipelineStateRespond;

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
};

// ─── 插件钩子 ────────────────────────────────────────────────

/**
 * 插件可以向 Pipeline 注册的钩子。
 *
 * 每个钩子在管道的特定点运行：
 * - onReceive: 处理步骤之前
 * - beforeLLMRequest: LLM 调用之前（在 Agent 处理之前由 Pipeline 调度）
 * - beforeToolCall: 工具执行之前（由 ToolAdapter 通过 HookDispatcher 调度）
 * - afterToolCall: 工具执行之后（由 ToolAdapter 通过 HookDispatcher 调度）
 * - onSend: 出站消息发送之前
 */
type PluginHooks = {
  onReceive?(message: InboundMessage, sessionKey: SessionKey, sender?: SenderInfo): Promise<PipelineResult>;
  beforeLLMRequest?(context: BeforeLLMRequestContext): Promise<PipelineResult>;
  beforeToolCall?(context: BeforeToolCallHookContext): Promise<BeforeToolCallHookResult>;
  afterToolCall?(context: AfterToolCallHookContext): Promise<AfterToolCallHookResult>;
  onSend?(context: OnSendContext): Promise<PipelineResult>;
};

export type { PipelineState, PipelineDependencies, PluginHooks };
