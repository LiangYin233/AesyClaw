/**
 * hook/types — 统一的 Hook 体系类型定义。
 *
 * 所有 hook 使用同一种中间件签名、同一种上下文、同一种结果，
 * 取代原先分散的 PipeCtx/SendCtx/BeforeToolCallHookContext 等。
 */

import type { Message, SessionKey, SenderInfo, RoleConfig } from '@aesyclaw/core/types';
import type { Session } from '@aesyclaw/session';
import type { Agent } from '@aesyclaw/agent/agent';
import type { ToolExecutionResult } from '@aesyclaw/tool/tool-registry';

// ─── Hook 链标识 ────────────────────────────────────────────────

/** 预定义的 hook 链名称 */
export type HookChain =
  | 'pipeline:receive'
  | 'pipeline:beforeLLM'
  | 'pipeline:send'
  | 'tool:beforeCall'
  | 'tool:afterCall';

// ─── 统一上下文 ─────────────────────────────────────────────────

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
  session?: Session;
  agent?: Agent;
  role?: RoleConfig;
  toolName?: string;
  toolParams?: unknown;
  toolResult?: ToolExecutionResult;
};

// ─── 统一结果 ───────────────────────────────────────────────────

/** 统一的 Hook 返回结果 */
export type HookResult =
  | { action: 'next' }
  | { action: 'respond'; message: Message }
  | { action: 'block'; reason?: string }
  | { action: 'override'; result: ToolExecutionResult };

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
