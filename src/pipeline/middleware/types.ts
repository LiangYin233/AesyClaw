/**
 * Middleware type definitions for the message processing pipeline.
 *
 * The pipeline uses a chain-of-responsibility (洋葱模型) pattern where
 * each middleware receives the current state and a `next` function.
 * Middlewares must either call `next(state)` to pass control to the
 * next middleware, or return the state directly to short-circuit the chain.
 *
 * @see project.md §5.5
 */

import type { InboundMessage, OutboundMessage } from '../../core/types';
import type { AppConfig } from '../../core/config/schema';
import type { CommandRegistry } from '../../command/command-registry';
import type { ConfigManager } from '../../core/config/config-manager';
import type { SessionManager } from '../../agent/session-manager';
import type { AgentEngine } from '../../agent/agent-engine';

// ─── Pipeline State ──────────────────────────────────────────────

/**
 * State object that flows through the middleware chain.
 *
 * Each middleware may read and mutate the state before passing it
 * to the next middleware via `next(state)`.
 */
interface PipelineState {
  /** The inbound message that entered the pipeline */
  inbound: InboundMessage;
  /** The outbound response, if produced by a middleware */
  outbound?: OutboundMessage;
  /** Current application config snapshot */
  config?: Readonly<AppConfig>;
  /** Session context — will be typed when SessionManager is implemented */
  session?: unknown;
  /** Whether the pipeline should stop processing */
  blocked?: boolean;
  /** Reason for blocking, if blocked */
  blockReason?: string;
}

// ─── Middleware ───────────────────────────────────────────────────

/** Next function — passes control to the next middleware in the chain */
type NextFn = (state: PipelineState) => Promise<PipelineState>;

/**
 * Middleware interface for the message processing pipeline.
 *
 * Middlewares are executed in registration order. Each one receives
 * the current state and a `next` function. To continue the chain,
 * call `next(state)`. To short-circuit, return the state directly
 * (without calling next).
 */
interface Middleware {
  /** Unique name for logging and debugging */
  name: string;
  /** Execute the middleware logic */
  execute(state: PipelineState, next: NextFn): Promise<PipelineState>;
}

// ─── Pipeline Dependencies ───────────────────────────────────────

/**
 * Dependencies injected into the Pipeline on initialization.
 *
 * Follows the DI pattern — all dependencies are explicitly passed
 * rather than imported as singletons.
 */
interface PipelineDependencies {
  configManager: ConfigManager;
  sessionManager: SessionManager;
  agentEngine: AgentEngine;
  commandRegistry: CommandRegistry;
  roleManager?: unknown;
  pluginManager: unknown;
}

// ─── Plugin Hooks ────────────────────────────────────────────────

/**
 * Hooks that a plugin can register with the HookDispatcher.
 *
 * Each hook runs at a specific point in the pipeline:
 * - onReceive: before the middleware chain
 * - beforeLLMRequest: before the LLM call (inside AgentProcessor)
 * - beforeToolCall: before a tool is executed
 * - afterToolCall: after a tool has been executed
 * - onSend: before the outbound message is sent
 */
interface PluginHooks {
  onReceive?(message: InboundMessage): Promise<PipelineResult>;
  beforeLLMRequest?(context: unknown): Promise<PipelineResult>;
  beforeToolCall?(context: BeforeToolCallHookContext): Promise<BeforeToolCallHookResult>;
  afterToolCall?(context: AfterToolCallHookContext): Promise<AfterToolCallHookResult>;
  onSend?(message: OutboundMessage): Promise<PipelineResult>;
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

export type {
  PipelineState,
  NextFn,
  Middleware,
  PipelineDependencies,
  PluginHooks,
};
