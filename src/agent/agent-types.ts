/**
 * Pi-mono Agent type stubs.
 *
 * These types mirror the Pi-mono Agent interface needed by ToolAdapter,
 * AgentEngine, SessionManager, and MemoryManager.
 *
 * Since the @mariozechner/pi-ai and @mariozechner/pi-agent-core packages
 * are not yet installed, we define the expected shapes here.
 *
 * When the Pi-mono packages are integrated, these stubs should be replaced
 * by importing directly from the package.
 *
 * @see project.md §5.6, §5.7, §5.8
 */

import type { SessionKey } from '../core/types';
import type { ToolExecutionResult } from '../tool/tool-registry';

// ─── Agent tool types ────────────────────────────────────────────

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

// ─── Agent context and hook types ────────────────────────────────

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

// ─── Agent message types (simulating Pi-mono) ───────────────────

/**
 * A message in the agent conversation.
 *
 * Mirrors the Pi-mono Agent message format. Used by MemoryManager
 * and AgentEngine for conversation history management.
 */
export interface AgentMessage {
  role: 'user' | 'assistant' | 'toolResult' | 'system';
  text: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  toolResult?: unknown;
}

/**
 * A tool call within an assistant message.
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

// ─── Resolved model type ─────────────────────────────────────────

/**
 * A fully resolved model configuration ready for use by the agent.
 *
 * Created by LlmAdapter.resolveModel from a "provider/model" identifier
 * by merging provider config and model preset.
 */
export interface ResolvedModel {
  provider: string;
  modelId: string;
  realModelName?: string;
  contextWindow: number;
  enableThinking: boolean;
  apiKey?: string;
  baseUrl?: string;
  apiType: string;
}

// ─── Agent state and interface ───────────────────────────────────

/**
 * The internal state of an Agent instance.
 *
 * Tracks the system prompt, model, tools, and conversation messages.
 */
export interface AgentState {
  systemPrompt: string;
  model: ResolvedModel;
  tools: AgentTool[];
  messages: AgentMessage[];
  thinkingLevel?: string;
}

/**
 * The Pi-mono Agent interface.
 *
 * The real implementation will use Pi-mono's Agent class.
 * For now, SimulatedAgent provides a local stub that simulates the
 * interface for development and testing.
 */
export interface Agent {
  state: AgentState;
  prompt(content: string): void;
  waitForIdle(): Promise<void>;
  reset(): void;
}

// ─── Stream function type ────────────────────────────────────────

/**
 * A function that streams LLM responses.
 *
 * The real implementation will use Pi-mono's stream API.
 * For now, this is a placeholder type.
 */
export type StreamFn = (
  model: unknown,
  messages: unknown[],
  options?: unknown,
) => AsyncIterable<unknown>;

// ─── Sub-agent types (§5.14) ─────────────────────────────────────

/**
 * Parameters for running a sub-agent with an existing role.
 */
export interface SubAgentRoleParams {
  roleId: string;
  prompt: string;
  /** Maximum number of tool-call rounds (default: from agent config) */
  maxSteps?: number;
  /** Whether the sub-agent can use tools (default: true) */
  enableTools?: boolean;
}

/**
 * Parameters for running a sub-agent with a temporary prompt.
 */
export interface SubAgentTempParams {
  systemPrompt: string;
  model?: string;
  prompt: string;
  /** Maximum number of tool-call rounds (default: from agent config) */
  maxSteps?: number;
  /** Whether the sub-agent can use tools (default: true) */
  enableTools?: boolean;
}

// ─── Memory config ───────────────────────────────────────────────

/**
 * Configuration for memory/history management.
 *
 * Matches the MemoryConfig schema in config/schema.ts.
 */
export interface MemoryConfig {
  maxContextTokens: number;
  compressionThreshold: number;
}

// ─── Simulated Agent (local stub) ────────────────────────────────

/**
 * Simulated Agent that mimics the Pi-mono Agent interface.
 *
 * Used for development and testing until the real Pi-mono Agent
 * integration is available. Produces simple echo-style responses.
 */
export class SimulatedAgent implements Agent {
  state: AgentState;

  constructor(state: AgentState) {
    this.state = state;
  }

  prompt(content: string): void {
    // Add user message to state
    this.state.messages.push({
      role: 'user',
      text: content,
    });

    // For simulation, add a simple assistant response
    this.state.messages.push({
      role: 'assistant',
      text: `[Simulated] Received: ${content}`,
    });
  }

  async waitForIdle(): Promise<void> {
    // No-op for simulation — response is immediate
  }

  reset(): void {
    this.state.messages = [];
  }
}