/**
 * Type definitions for the message processing pipeline.
 *
 * The pipeline uses sequential processing steps. Each step receives
 * the current state and returns a mutated copy.
 */

import type { InboundMessage, OutboundMessage } from '../../core/types';
import type { AppConfig } from '../../core/config/schema';
import type { CommandRegistry } from '../../command/command-registry';
import type { ConfigManager } from '../../core/config/config-manager';
import type { SessionContext, SessionManager } from '../../agent/session-manager';
import type { AgentEngine } from '../../agent/agent-engine';

// ─── Pipeline State ──────────────────────────────────────────────

/**
 * State object that flows through pipeline processing steps.
 *
 * Each step may read and mutate the state before passing it along.
 */
interface PipelineState {
  /** The inbound message that entered the pipeline */
  inbound: InboundMessage;
  /** The outbound response, if produced by a step */
  outbound?: OutboundMessage;
  /** onSend-aware outbound delivery callback for tool execution */
  sendMessage?: (message: OutboundMessage) => Promise<boolean>;
  /** Current application config snapshot */
  config?: Readonly<AppConfig>;
  /** Session context resolved for the inbound message */
  session?: SessionContext;
  /** Whether the pipeline should stop processing */
  blocked?: boolean;
  /** Reason for blocking, if blocked */
  blockReason?: string;
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
}

// ─── Plugin Hooks ────────────────────────────────────────────────

/**
 * Hooks that a plugin can register with the HookDispatcher.
 *
 * Each hook runs at a specific point in the pipeline:
 * - onReceive: before the processing steps
 * - beforeLLMRequest: before the LLM call (inside agent processing)
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

export type { PipelineState, PipelineDependencies, PluginHooks };
