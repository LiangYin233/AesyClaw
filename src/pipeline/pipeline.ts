/**
 * Pipeline — message processing pipeline with middleware chain and hook dispatch.
 *
 * The pipeline is the central message processing orchestrator. It receives
 * inbound messages, dispatches plugin hooks, runs the middleware chain,
 * and sends outbound responses.
 *
 * Flow:
 *   1. HookDispatcher.dispatchOnReceive(message) → if block, stop
 *   2. Middleware chain: ConfigInjection → SessionResolver → CommandDetector → AgentProcessor
 *   3. After chain: if state.blocked, stop
 *   4. HookDispatcher.dispatchOnSend(outbound) → if block, stop
 *   5. send(outbound)
 *
 */

import type { InboundMessage, OutboundMessage, SendFn } from '../core/types';
import type { Middleware, NextFn, PipelineDependencies, PipelineState } from './middleware/types';
import { HookDispatcher } from './hook-dispatcher';
import { ConfigInjectionMiddleware } from './middleware/config-injection';
import { SessionResolverMiddleware } from './middleware/session-resolver';
import { CommandDetectorMiddleware } from './middleware/command-detector';
import { AgentProcessorMiddleware } from './middleware/agent-processor';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('pipeline');

/**
 * Central message processing pipeline.
 *
 * Follows the lifecycle pattern: initialize() / destroy().
 * Dependencies are injected explicitly — no singleton imports.
 */
export class Pipeline {
  private middlewares: Middleware[] = [];
  private hookDispatcher: HookDispatcher = new HookDispatcher();
  private initialized = false;

  // ─── Lifecycle ─────────────────────────────────────────────────

  /**
   * Initialize the pipeline with its dependencies.
   *
   * Registers the default middleware chain in order:
   * 1. ConfigInjectionMiddleware
   * 2. SessionResolverMiddleware
   * 3. CommandDetectorMiddleware
   * 4. AgentProcessorMiddleware
   */
  initialize(deps: PipelineDependencies): void {
    if (this.initialized) {
      logger.warn('Pipeline already initialized — skipping');
      return;
    }

    // Register default middleware chain
    this.middlewares = [
      new ConfigInjectionMiddleware(deps.configManager),
      new SessionResolverMiddleware(deps.sessionManager),
      new CommandDetectorMiddleware(deps.commandRegistry),
      new AgentProcessorMiddleware(deps.agentEngine, this.hookDispatcher),
    ];

    this.initialized = true;
    logger.info('Pipeline initialized');
  }

  /**
   * Destroy the pipeline — clears all middlewares and hook registrations.
   */
  destroy(): void {
    this.middlewares = [];
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
    if (!this.initialized) {
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

      // If a hook provides a response, send it directly (skip middleware chain)
      if (receiveResult.action === 'respond') {
        const outbound: OutboundMessage = { content: (receiveResult as { action: 'respond'; content: string }).content };
        await this.dispatchOnSendAndDeliver(outbound, send);
        return;
      }

      // 2. Execute middleware chain
      const initialState: PipelineState = {
        inbound: message,
        sendMessage: async (outbound: OutboundMessage): Promise<boolean> =>
          this.dispatchOnSendAndDeliver(outbound, send),
      };
      const finalState = await this.executeChain(initialState);

      // 3. After chain: if state is blocked, stop
      if (finalState.blocked) {
        logger.info('Pipeline blocked by middleware', {
          reason: finalState.blockReason,
        });
        return;
      }

      // 4. If an outbound message was produced, dispatch onSend and deliver
      if (finalState.outbound) {
        await this.dispatchOnSendAndDeliver(finalState.outbound, send);
      }
    } catch (err) {
      logger.error('Pipeline processing error', err);
    }
  }

  /**
   * Add a middleware to the chain.
   *
   * Middlewares are executed in the order they are added.
   * Should be called after initialize().
   */
  use(middleware: Middleware): void {
    this.middlewares.push(middleware);
    logger.debug(`Added middleware: ${middleware.name}`);
  }

  /**
   * Get the hook dispatcher for plugin hook registration.
   */
  getHookDispatcher(): HookDispatcher {
    return this.hookDispatcher;
  }

  // ─── Private helpers ───────────────────────────────────────────

  /**
   * Execute the middleware chain recursively.
   *
   * Uses a recursive next() function that calls each middleware
   * in order, passing `next` to each one. The final middleware
   * calls the identity next function which simply returns the state.
   */
  private async executeChain(state: PipelineState): Promise<PipelineState> {
    // Start from index 0
    return this.runMiddleware(state, 0);
  }

  /**
   * Recursively run a middleware at the given index.
   *
   * If the index is past the end of the middleware array,
   * return the state unchanged (identity terminator).
   */
  private async runMiddleware(state: PipelineState, index: number): Promise<PipelineState> {
    if (index >= this.middlewares.length) {
      return state;
    }

    const middleware = this.middlewares[index];
    const next: NextFn = (s: PipelineState) => this.runMiddleware(s, index + 1);

    try {
      return await middleware.execute(state, next);
    } catch (err) {
      logger.error(`Middleware "${middleware.name}" threw an error`, err);
      // On middleware error, mark as blocked rather than crashing
      state.blocked = true;
      state.blockReason = `Middleware "${middleware.name}" error: ${err instanceof Error ? err.message : String(err)}`;
      return state;
    }
  }

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
