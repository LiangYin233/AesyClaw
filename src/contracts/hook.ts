/**
 * contracts/hook — Hook 体系公共类型。
 *
 * 独立于具体 Agent / Session / Tool 实现，仅依赖基础设施类型和契约接口。
 */

import type { Message, SessionKey, SenderInfo, RoleConfig } from '@aesyclaw/core/types';
import type { SessionRuntimeRef } from '@aesyclaw/contracts/session';
import type { AgentRuntimeRef } from '@aesyclaw/contracts/agent';

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
  | { action: 'override'; result: HookToolExecutionResult };

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
