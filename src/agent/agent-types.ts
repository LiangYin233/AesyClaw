/**
 * Pi-mono Agent type stubs.
 *
 * These types mirror the Pi-mono Agent interface needed by ToolAdapter.
 * Since the @mariozechner/pi-ai and @mariozechner/pi-agent-core packages
 * are not yet installed, we define the expected shapes here.
 *
 * When the Pi-mono packages are integrated, these stubs should be replaced
 * by importing directly from the package.
 *
 * @see project.md §5.6
 */

import type { SessionKey } from '../core/types';
import type { ToolExecutionResult } from '../tool/tool-registry';

/**
 * A tool in the Pi-mono Agent interface format.
 *
 * This is the shape that the AgentEngine expects when registering
 * tools with the LLM agent runtime.
 */
export interface AgentTool {
  name: string;
  description: string;
  /** TypeBox schema or JSON Schema describing the tool parameters */
  parameters: unknown;
  execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<AgentToolResult>;
}

/**
 * Result returned by an AgentTool.execute call.
 */
export interface AgentToolResult {
  content: string;
  isError?: boolean;
}

/**
 * Agent context provided to tools during execution.
 *
 * Will be expanded when AgentEngine is implemented.
 */
export interface AgentContext {
  sessionKey: SessionKey;
}

/**
 * Context for beforeToolCall hooks.
 */
export interface BeforeToolCallHookContext {
  toolName: string;
  params: unknown;
  sessionKey: SessionKey;
}

/**
 * Context for afterToolCall hooks.
 */
export interface AfterToolCallHookContext {
  toolName: string;
  params: unknown;
  result: ToolExecutionResult;
  sessionKey: SessionKey;
}

/**
 * Result of a beforeToolCall hook.
 *
 * If `block` is true, the tool call is rejected.
 * If `shortCircuit` is provided, the provided result is returned
 * without executing the actual tool.
 */
export interface BeforeToolCallHookResult {
  block?: boolean;
  reason?: string;
  shortCircuit?: ToolExecutionResult;
}

/**
 * Result of an afterToolCall hook.
 *
 * If `override` is provided, the tool's result is partially replaced.
 */
export interface AfterToolCallHookResult {
  override?: Partial<ToolExecutionResult>;
}