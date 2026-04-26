/**
 * Pipeline — message processing pipeline with sequential steps and hook dispatch.
 *
 * The pipeline is the central message processing orchestrator. It receives
 * inbound messages, dispatches plugin hooks, runs the processing steps,
 * and sends outbound responses.
 *
 * Flow:
 *   1. HookDispatcher.dispatchOnReceive(message) → if block, stop
 *   2. Sequential steps: configInjection → sessionResolver → commandDetector → agentProcessor
 *   3. If state.blocked, stop
 *   4. HookDispatcher.dispatchOnSend(outbound) → if block, stop
 *   5. send(outbound)
 *
 */

import type { InboundMessage, OutboundMessage, SendFn } from '../core/types';
import type { PipelineDependencies, PipelineState } from './middleware/types';
import { HookDispatcher } from './hook-dispatcher';
import { configInjection } from './middleware/config-injection';
import { sessionResolver } from './middleware/session-resolver';
import { commandDetector } from './middleware/command-detector';
import { agentProcessor } from './middleware/agent-processor';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('pipeline');

/**
 * Central message processing pipeline.
 *
 * Follows the lifecycle pattern: initialize() / destroy().
 * Dependencies are injected explicitly — no singleton imports.
 */
export class Pipeline {
  private hookDispatcher: HookDispatcher = new HookDispatcher();
  private deps: PipelineDependencies | null = null;
  private initialized = false;

  // ─── Lifecycle ─────────────────────────────────────────────────

  /**
   * Initialize the pipeline with its dependencies.
   */
  initialize(deps: PipelineDependencies): void {
    if (this.initialized) {
      logger.warn('Pipeline already initialized — skipping');
      return;
    }

    this.deps = deps;
    this.initialized = true;
    logger.info('Pipeline initialized');
  }

  /**
   * Destroy the pipeline — clears hook registrations.
   */
  destroy(): void {
    this.deps = null;
    this.initialized = false;
    logger.info('Pipeline destroyed');
  }

  // ─── Core API ─────────────────────────────────────────────────

  /**
   * Process an inbound message and send the response.
   *
   * This is the main entry point for message processing.
   *
   * @param message - The inbound message from a channel
   * @param send - Function to send the outbound response
   */
  async receiveWithSend(message: InboundMessage, send: SendFn): Promise<void> {
    if (!this.initialized || !this.deps) {
      logger.error('Pipeline not initialized — cannot process message');
      return;
    }

    try {
      // 1. Dispatch onReceive hooks — if blocked, stop
      const receiveResult = await this.hookDispatcher.dispatchOnReceive(message);
      if (receiveResult.action === 'block') {
        logger.info('Message blocked by onReceive hook', {
          reason: receiveResult.reason,
        });
        return;
      }

      // If a hook provides a response, send it directly (skip processing steps)
      if (receiveResult.action === 'respond') {
        const outbound: OutboundMessage = {
          content: (receiveResult as { action: 'respond'; content: string }).content,
        };
        await this.dispatchOnSendAndDeliver(outbound, send);
        return;
      }

      // 2. Execute sequential processing steps
      let state: PipelineState = {
        inbound: message,
        sendMessage: async (outbound: OutboundMessage): Promise<boolean> =>
          this.dispatchOnSendAndDeliver(outbound, send),
      };

      state = await configInjection(state, this.deps.configManager);
      state = await sessionResolver(state, this.deps.sessionManager);
      state = await commandDetector(state, this.deps.commandRegistry);

      // If commandDetector set an outbound, skip agent processing
      if (!state.outbound) {
        state = await agentProcessor(state, this.deps.agentEngine, this.hookDispatcher);
      }

      // 3. After processing: if state is blocked, stop
      if (state.blocked) {
        logger.info('Pipeline blocked', {
          reason: state.blockReason,
        });
        return;
      }

      // 4. If an outbound message was produced, dispatch onSend and deliver
      if (state.outbound) {
        await this.dispatchOnSendAndDeliver(state.outbound, send);
      }
    } catch (err) {
      logger.error('Pipeline processing error', err);
    }
  }

  /**
   * Get the hook dispatcher for plugin hook registration.
   */
  getHookDispatcher(): HookDispatcher {
    return this.hookDispatcher;
  }

  // ─── Private helpers ───────────────────────────────────────────

  /**
   * Dispatch onSend hooks and, if not blocked, deliver the outbound message.
   */
  private async dispatchOnSendAndDeliver(
    outbound: OutboundMessage,
    send: SendFn,
  ): Promise<boolean> {
    const sendResult = await this.hookDispatcher.dispatchOnSend(outbound);
    if (sendResult.action === 'block') {
      logger.info('Outbound blocked by onSend hook', {
        reason: sendResult.reason,
      });
      return false;
    }

    // If a hook responds, use that content instead
    const finalOutbound: OutboundMessage =
      sendResult.action === 'respond'
        ? { content: (sendResult as { action: 'respond'; content: string }).content }
        : outbound;

    await send(finalOutbound);
    return true;
  }
}
