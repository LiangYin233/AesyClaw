/**
 * HookDispatcher — dispatches plugin hooks at pipeline lifecycle points.
 *
 * Plugins register hooks (onReceive, onSend, beforeToolCall, afterToolCall,
 * beforeLLMRequest) which are called by the pipeline at the appropriate points.
 *
 * Dispatch rules:
 * - Hooks are called in registration order
 * - If any hook returns a terminal result, dispatch stops and returns that result
 * - Otherwise returns the default continue result
 */

import type { InboundMessage, OutboundMessage, PipelineResult } from '../core/types';
import type {
  BeforeToolCallHookContext,
  BeforeToolCallHookResult,
  AfterToolCallHookContext,
  AfterToolCallHookResult,
} from '../agent/agent-types';
import type { PluginHooks } from './middleware/types';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('hook');

/**
 * Entry tracking a plugin's registered hooks.
 */
interface HookEntry {
  pluginName: string;
  hooks: PluginHooks;
}

/**
 * Dispatch helper — iterates registered hooks and calls `extract` to get
 * the hook function (or undefined). The `check` function decides whether
 * a hook result is terminal (stops dispatch) or should continue to the next hook.
 *
 * Returns the default value if no hook produced a terminal result.
 */
async function dispatchHooks<T, D>(
  entries: HookEntry[],
  extract: (hooks: PluginHooks) => ((context: T) => Promise<D>) | undefined,
  check: (result: D) => boolean,
  defaultValue: D,
  context: T,
): Promise<D> {
  for (const entry of entries) {
    const hookFn = extract(entry.hooks);
    if (!hookFn) continue;

    try {
      const result = await hookFn(context);
      if (check(result)) {
        return result;
      }
    } catch (err) {
      logger.error(`Hook error in plugin "${entry.pluginName}"`, err);
    }
  }

  return defaultValue;
}

/** Check if a PipelineResult is terminal (block or respond) */
function isPipelineResultTerminal(result: PipelineResult): boolean {
  return result.action !== 'continue';
}

/** Default PipelineResult */
const CONTINUE_RESULT: PipelineResult = { action: 'continue' };

/** Default before tool call result */
const EMPTY_BEFORE_TOOL: BeforeToolCallHookResult = {};

/** Default after tool call result */
const EMPTY_AFTER_TOOL: AfterToolCallHookResult = {};

/**
 * Full HookDispatcher implementation.
 */
export class HookDispatcher {
  private entries: HookEntry[] = [];

  // ─── Registration ───────────────────────────────────────────────

  /**
   * Register a plugin's hooks.
   *
   * @param pluginName - Unique plugin identifier (for unregister)
   * @param hooks - Object containing the hook functions the plugin provides
   */
  register(pluginName: string, hooks: PluginHooks): void {
    // Prevent duplicate registration
    const existing = this.entries.find((e) => e.pluginName === pluginName);
    if (existing) {
      logger.warn(`Plugin "${pluginName}" already has hooks registered — replacing`);
      existing.hooks = hooks;
      return;
    }
    this.entries.push({ pluginName, hooks });
    logger.debug(`Registered hooks for plugin: ${pluginName}`);
  }

  /**
   * Unregister a plugin's hooks.
   *
   * No-op if the plugin has no registered hooks.
   */
  unregister(pluginName: string): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.pluginName !== pluginName);
    if (this.entries.length < before) {
      logger.debug(`Unregistered hooks for plugin: ${pluginName}`);
    }
  }

  // ─── Dispatch methods ───────────────────────────────────────────

  async dispatchOnReceive(message: InboundMessage): Promise<PipelineResult> {
    return dispatchHooks(
      this.entries,
      (hooks) => hooks.onReceive,
      isPipelineResultTerminal,
      CONTINUE_RESULT,
      message,
    );
  }

  async dispatchOnSend(message: OutboundMessage): Promise<PipelineResult> {
    return dispatchHooks(
      this.entries,
      (hooks) => hooks.onSend,
      isPipelineResultTerminal,
      CONTINUE_RESULT,
      message,
    );
  }

  async dispatchBeforeToolCall(
    context: BeforeToolCallHookContext,
  ): Promise<BeforeToolCallHookResult> {
    return dispatchHooks(
      this.entries,
      (hooks) => hooks.beforeToolCall,
      (result) => result.block === true || result.shortCircuit !== undefined,
      EMPTY_BEFORE_TOOL,
      context,
    );
  }

  async dispatchAfterToolCall(context: AfterToolCallHookContext): Promise<AfterToolCallHookResult> {
    return dispatchHooks(
      this.entries,
      (hooks) => hooks.afterToolCall,
      (result) => result.override !== undefined,
      EMPTY_AFTER_TOOL,
      context,
    );
  }

  async dispatchBeforeLLMRequest(context: unknown): Promise<PipelineResult> {
    return dispatchHooks(
      this.entries,
      (hooks) => hooks.beforeLLMRequest,
      isPipelineResultTerminal,
      CONTINUE_RESULT,
      context,
    );
  }
}
