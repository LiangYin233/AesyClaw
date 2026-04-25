/**
 * HookDispatcher — dispatches plugin hooks at pipeline lifecycle points.
 *
 * Plugins register hooks (onReceive, onSend, beforeToolCall, afterToolCall,
 * beforeLLMRequest) which are called by the pipeline at the appropriate points.
 *
 * Dispatch rules:
 * - Hooks are called in registration order
 * - If any hook returns `{ action: 'block' }`, dispatch stops and returns the block result
 * - If any hook returns `{ action: 'respond', content }`, dispatch stops and returns that response
 * - Otherwise returns `{ action: 'continue' }`
 *
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
 * Full HookDispatcher implementation.
 *
 * Replaces the minimal interface previously exported from this module.
 * The old `HookDispatcher` interface is now implemented by this class.
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

  // ─── Dispatch: onReceive ────────────────────────────────────────

  /**
   * Dispatch onReceive hooks — called before the middleware chain.
   *
   * If any hook blocks or responds, the pipeline should skip the
   * middleware chain entirely.
   */
  async dispatchOnReceive(message: InboundMessage): Promise<PipelineResult> {
    for (const entry of this.entries) {
      if (!entry.hooks.onReceive) continue;
      try {
        const result = await entry.hooks.onReceive(message);
        if (result.action === 'block') {
          logger.info(`onReceive blocked by plugin "${entry.pluginName}"`, {
            reason: result.reason,
          });
          return result;
        }
        if (result.action === 'respond') {
          logger.info(`onReceive responded by plugin "${entry.pluginName}"`);
          return result;
        }
        // action === 'continue' — proceed to next hook
      } catch (err) {
        logger.error(`onReceive hook error in plugin "${entry.pluginName}"`, err);
        // Continue to next hook — don't let one failing hook break the pipeline
      }
    }
    return { action: 'continue' };
  }

  // ─── Dispatch: onSend ───────────────────────────────────────────

  /**
   * Dispatch onSend hooks — called before sending the outbound message.
   *
   * If any hook blocks, the message should not be sent.
   */
  async dispatchOnSend(message: OutboundMessage): Promise<PipelineResult> {
    for (const entry of this.entries) {
      if (!entry.hooks.onSend) continue;
      try {
        const result = await entry.hooks.onSend(message);
        if (result.action === 'block') {
          logger.info(`onSend blocked by plugin "${entry.pluginName}"`, {
            reason: result.reason,
          });
          return result;
        }
        if (result.action === 'respond') {
          logger.info(`onSend responded by plugin "${entry.pluginName}"`);
          return result;
        }
      } catch (err) {
        logger.error(`onSend hook error in plugin "${entry.pluginName}"`, err);
      }
    }
    return { action: 'continue' };
  }

  // ─── Dispatch: beforeToolCall ────────────────────────────────────

  /**
   * Dispatch beforeToolCall hooks — called before a tool is executed.
   *
   * Hooks may block the call or provide a short-circuit result.
   */
  async dispatchBeforeToolCall(
    context: BeforeToolCallHookContext,
  ): Promise<BeforeToolCallHookResult> {
    for (const entry of this.entries) {
      if (!entry.hooks.beforeToolCall) continue;
      try {
        const result = await entry.hooks.beforeToolCall(context);
        if (result.block) {
          logger.info(`beforeToolCall blocked by plugin "${entry.pluginName}"`, {
            toolName: context.toolName,
            reason: result.reason,
          });
          return result;
        }
        if (result.shortCircuit) {
          logger.info(`beforeToolCall short-circuited by plugin "${entry.pluginName}"`, {
            toolName: context.toolName,
          });
          return result;
        }
      } catch (err) {
        logger.error(`beforeToolCall hook error in plugin "${entry.pluginName}"`, err);
      }
    }
    return {}; // No block, no short-circuit → proceed
  }

  // ─── Dispatch: afterToolCall ─────────────────────────────────────

  /**
   * Dispatch afterToolCall hooks — called after a tool has been executed.
   *
   * Hooks may override the tool result.
   */
  async dispatchAfterToolCall(context: AfterToolCallHookContext): Promise<AfterToolCallHookResult> {
    for (const entry of this.entries) {
      if (!entry.hooks.afterToolCall) continue;
      try {
        const result = await entry.hooks.afterToolCall(context);
        if (result.override) {
          logger.info(`afterToolCall overridden by plugin "${entry.pluginName}"`, {
            toolName: context.toolName,
          });
          return result;
        }
      } catch (err) {
        logger.error(`afterToolCall hook error in plugin "${entry.pluginName}"`, err);
      }
    }
    return {}; // No override → keep original result
  }

  // ─── Dispatch: beforeLLMRequest ──────────────────────────────────

  /**
   * Dispatch beforeLLMRequest hooks — called before sending a request
   * to the LLM (inside AgentProcessor).
   */
  async dispatchBeforeLLMRequest(context: unknown): Promise<PipelineResult> {
    for (const entry of this.entries) {
      if (!entry.hooks.beforeLLMRequest) continue;
      try {
        const result = await entry.hooks.beforeLLMRequest(context);
        if (result.action === 'block') {
          logger.info(`beforeLLMRequest blocked by plugin "${entry.pluginName}"`, {
            reason: result.reason,
          });
          return result;
        }
        if (result.action === 'respond') {
          logger.info(`beforeLLMRequest responded by plugin "${entry.pluginName}"`);
          return result;
        }
      } catch (err) {
        logger.error(`beforeLLMRequest hook error in plugin "${entry.pluginName}"`, err);
      }
    }
    return { action: 'continue' };
  }
}
