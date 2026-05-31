/**
 * contracts/hook — Hook 体系公共类型。
 *
 * 独立于具体 Agent / Session / Tool 实现，仅依赖基础设施类型和契约接口。
 */

import type { Message, SessionKey, SenderInfo, RoleConfig } from '@aesyclaw/core/types';
import type { AgentMessage, ModelResolver, ResolvedModel } from '@aesyclaw/contracts/llm';
import type { OutboundSignal } from '@aesyclaw/core/types';

// ─── 运行时引用类型 ──────────────────────────────────────────────

/** Hook 层可用的会话运行时引用（Session 的最小视图） */
export type SessionRuntimeRef = {
  readonly sessionId: string;
  readonly key: SessionKey;
  readonly isLocked: boolean;
  lock(): boolean;
  unlock(): void;
  get(): readonly AgentMessage[];
  add(message: AgentMessage): Promise<void>;
  bind(): Promise<void>;
  clear(): Promise<void>;
  compact(llmAdapter: ModelResolver, modelIdentifier: string): Promise<string>;
};

/** callLLM 的返回结果 */
export type CallLLMResult = {
  newMessages: AgentMessage[];
  lastAssistant: string | null;
  cancelled: boolean;
};

/** Hook 层可用的 Agent 运行时引用 */
export type AgentRuntimeRef = {
  readonly session: SessionRuntimeRef;
  roleId?: string;
  readonly model: ResolvedModel;
  readonly modelIdentifier: string;
  readonly activeRole: RoleConfig | null;
  setModel(modelId: string): void;
  setRole(role: RoleConfig): Promise<void>;
  invalidatePromptCache(): void;
  callLLM(
    role: RoleConfig,
    content: string,
    history: AgentMessage[],
    sessionKey: SessionKey,
    sendMessage?: (message: Message) => Promise<boolean>,
    onStream?: (event: OutboundSignal) => void,
  ): Promise<CallLLMResult>;
  /** 处理用户消息并返回回复 */
  process(
    message: Message,
    sendMessage?: (message: Message) => Promise<boolean>,
    options?: { ephemeral?: boolean; role?: RoleConfig },
    onStream?: (event: OutboundSignal) => void,
  ): Promise<Message>;
};

// ─── Hook 链标识 ────────────────────────────────────────────────

/** 预定义的 hook 链名称 */
export type HookChain =
  | 'pipeline:receive'
  | 'pipeline:beforeLLM'
  | 'pipeline:send'
  | 'tool:beforeCall'
  | 'tool:afterCall';

// ─── 统一上下文 ─────────────────────────────────────────────────

/** 工具执行结果（轻量定义，避免直接依赖 tool-registry） */
export type HookToolExecutionResult = {
  content: string;
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
};

/**
 * 统一 Hook 上下文，贯穿整个管道生命周期。
 *
 * 不同阶段可用字段不同：
 * - pipeline:receive — message / sessionKey / sender
 * - pipeline:beforeLLM — 额外填充 session / agent / role
 * - pipeline:send — message / sessionKey
 * - tool:beforeCall — 填充 toolName / toolParams
 * - tool:afterCall — 额外填充 toolResult
 */
export type HookCtx = {
  message: Message;
  sessionKey: SessionKey;
  sender?: SenderInfo;
  session?: SessionRuntimeRef;
  agent?: AgentRuntimeRef;
  role?: RoleConfig;
  toolName?: string;
  toolParams?: unknown;
  toolResult?: HookToolExecutionResult;
};

// ─── 统一结果 ───────────────────────────────────────────────────

/** 统一的 Hook 返回结果 */
export type HookResult =
  | { action: 'next' }
  | { action: 'respond'; message: Message }
  | { action: 'block'; reason?: string }
  | { action: 'override'; result: HookToolExecutionResult }
  | { action: 'error'; reason: string };

// ─── 中间件 ─────────────────────────────────────────────────────

/**
 * 统一的中间件签名。
 *
 * @param ctx - 可变的上下文对象，中间件可以读写
 * @param next - 调用下一个中间件；不调用则短路
 * @returns HookResult
 */
export type Middleware = (ctx: HookCtx, next?: () => Promise<HookResult>) => Promise<HookResult>;

// ─── 注册 ───────────────────────────────────────────────────────

/** 单个 Hook 注册条目 */
export type HookRegistration = {
  id: string;
  chain: HookChain;
  priority: number;
  enabled: boolean;
  handler: Middleware;
};

// ─── Hook 总线接口 ─────────────────────────────────────────────

/** Hook 总线公共接口 */
export type IHooksBus = {
  register(registration: HookRegistration): void;
  unregister(id: string): void;
  /** 按前缀批量注销 */
  unregisterByPrefix(prefix: string): void;
  dispatch(chain: HookChain, ctx: HookCtx): Promise<HookResult>;
  clear(): void;
};
