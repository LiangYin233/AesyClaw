/**
 * Hook dispatcher interface for plugin hooks.
 *
 * This is a minimal interface that ToolAdapter and other subsystems
 * can reference without creating a circular dependency. The full
 * HookDispatcher implementation will be added when the plugin system
 * is built out.
 *
 * @see project.md §5.5
 */

import type {
  BeforeToolCallHookContext,
  BeforeToolCallHookResult,
  AfterToolCallHookContext,
  AfterToolCallHookResult,
} from '../agent/agent-types';

/**
 * HookDispatcher — dispatches before/after tool call hooks
 * registered by plugins.
 *
 * The implementation will be provided by the PluginManager subsystem.
 * This interface allows ToolAdapter to reference the dispatch methods
 * without depending on the full plugin system.
 */
export interface HookDispatcher {
  dispatchBeforeToolCall(context: BeforeToolCallHookContext): Promise<BeforeToolCallHookResult>;
  dispatchAfterToolCall(context: AfterToolCallHookContext): Promise<AfterToolCallHookResult>;
}