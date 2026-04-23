/**
 * Tool registry — manages tool registration and execution.
 *
 * This file currently contains only the core type definitions needed
 * by other subsystems (RoleManager, AgentEngine). The full ToolRegistry
 * implementation will be added in a future task.
 *
 * @see project.md §5.6
 */

import type { TSchema } from '@sinclair/typebox';
import type { ToolOwner } from '../core/types';

/**
 * Result of executing a tool.
 *
 * Tools return structured results rather than throwing errors,
 * allowing the Agent LLM to reason about failures and retries.
 */
export interface ToolExecutionResult {
  content: string;
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}

/**
 * A tool that can be registered with the Agent.
 *
 * Each tool has an owner scope for automatic cleanup when the owning
 * subsystem (plugin, MCP server) is unloaded.
 */
export interface AesyClawTool<TParams extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParams;
  owner: ToolOwner;
  execute: (params: unknown, context: unknown) => Promise<ToolExecutionResult>;
}