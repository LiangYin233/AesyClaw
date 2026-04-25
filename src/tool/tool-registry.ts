/**
 * Tool registry — manages tool registration and execution.
 *
 * Provides registration, unregistration, owner-scoped cleanup,
 * and role-based permission filtering. Converts registered tools
 * to the Pi-mono AgentTool format via ToolAdapter.
 *
 */

import { Type, Static, TSchema } from '@sinclair/typebox';
import type { ToolOwner, SessionKey, RoleConfig, OutboundMessage } from '../core/types';
import { createScopedLogger } from '../core/logger';
import type { HookDispatcher } from '../pipeline/hook-dispatcher';
import type { AgentTool } from '../agent/agent-types';
import { ToolAdapter } from './tool-adapter';

const logger = createScopedLogger('tool');

// ─── Core types ───────────────────────────────────────────────────

/**
 * Result of executing a tool.
 *
 * Tools return structured results rather than throwing errors,
 * allowing the Agent LLM to reason about failures and retries.
 *
 * @see error-handling.md — "Agent Tool Execution: Return Error Result"
 */
export interface ToolExecutionResult {
  content: string;
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}

/**
 * Tool execution context provided to tool execute functions.
 *
 * Will be expanded as more subsystems are implemented.
 */
export interface ToolExecutionContext {
  sessionKey: SessionKey;
  /** Sends through the pipeline's onSend-aware delivery path when available */
  sendMessage?: (message: OutboundMessage) => Promise<boolean>;
}

/**
 * A tool that can be registered with the Agent.
 *
 * Each tool has an owner scope for automatic cleanup when the owning
 * subsystem (plugin, MCP server) is unloaded.
 *
 * Parameter schemas use TypeBox (`TSchema`) so they can be converted
 * to JSON Schema for the LLM tool interface. The `execute` function
 * receives `params: unknown`; individual tool implementations narrow
 * the type internally using `Static<typeof SchemaParam>` assertions,
 * validated at runtime through the TypeBox schema.
 *
 * Why `unknown` instead of a generic?
 * Tools are stored in a heterogeneous registry. A generic `execute`
 * parameter would be contravariant, preventing
 * `AesyClawTool<SpecificSchema>` from being assignable to `AesyClawTool`.
 * Since the adapter always passes `unknown` params (from LLM output),
 * `unknown` is the honest, runtime-accurate type. TypeBox `Static<>`
 * + runtime validation ensures type safety at each call site.
 */
export interface AesyClawTool {
  name: string;
  description: string;
  parameters: TSchema;
  owner: ToolOwner;
  execute: (params: unknown, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

// ─── ToolRegistry ──────────────────────────────────────────────────

/**
 * Central registry for all tools available to the agent.
 *
 * Tools are registered with an owner scope so that when a plugin
 * or MCP server is unloaded, all its tools can be removed in one call
 * via `unregisterByOwner()`.
 *
 * The registry enforces name uniqueness — attempting to register a
 * tool with a name that already exists throws an error.
 */
export class ToolRegistry {
  private tools: Map<string, AesyClawTool> = new Map();

  /**
   * Register a tool.
   *
   * @throws Error if a tool with the same name already exists
   */
  register(tool: AesyClawTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
    logger.debug(`Registered tool: ${tool.name} (owner: ${tool.owner})`);
  }

  /**
   * Unregister a tool by name.
   *
   * No-op if the tool doesn't exist.
   */
  unregister(name: string): void {
    const removed = this.tools.delete(name);
    if (removed) {
      logger.debug(`Unregistered tool: ${name}`);
    }
  }

  /**
   * Unregister all tools owned by a given owner.
   *
   * Used for cleanup when a plugin or MCP server is unloaded.
   */
  unregisterByOwner(owner: ToolOwner): void {
    let count = 0;
    for (const [name, tool] of this.tools) {
      if (tool.owner === owner) {
        this.tools.delete(name);
        count++;
      }
    }
    if (count > 0) {
      logger.debug(`Unregistered ${count} tools owned by ${owner}`);
    }
  }

  /** Get all registered tools. */
  getAll(): AesyClawTool[] {
    return [...this.tools.values()];
  }

  /** Get a tool by name, or undefined if not found. */
  get(name: string): AesyClawTool | undefined {
    return this.tools.get(name);
  }

  /** Check whether a tool with the given name is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Resolve the set of tools available to a given role,
   * applying permission filtering and converting to AgentTool format.
   *
   * @param role - The role whose permissions determine which tools are available
   * @param hookDispatcher - Dispatches before/after tool call hooks
   * @param executionContext - Context provided to tool execute functions
   * @returns Array of AgentTool instances ready for the agent runtime
   */
  resolveForRole(
    role: RoleConfig,
    hookDispatcher: HookDispatcher,
    executionContext: Partial<ToolExecutionContext>,
  ): AgentTool[] {
    const allTools = this.getAll();
    const filtered = filterToolsByRole(allTools, role);
    return filtered.map((tool) =>
      ToolAdapter.toAgentTool(tool, hookDispatcher, executionContext),
    );
  }
}

// ─── Utility functions ─────────────────────────────────────────────

/**
 * Filter tools based on role permissions.
 *
 * - allowlist mode: only keep tools whose names are in the list
 * - denylist mode: exclude tools whose names are in the list
 */
export function filterToolsByRole(tools: AesyClawTool[], role: RoleConfig): AesyClawTool[] {
  const { mode, list } = role.toolPermission;

  if (mode === 'allowlist') {
    if (list.includes('*')) {
      return tools;
    }
    return tools.filter((tool) => list.includes(tool.name));
  }

  // denylist mode
  return tools.filter((tool) => !list.includes(tool.name));
}
