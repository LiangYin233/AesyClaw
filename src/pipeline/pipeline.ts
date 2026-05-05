/**
 * Pipeline — 中央消息处理管道。
 *
 * 管道是唯一的控制流管理者。它接收入站消息,
 * 调度插件钩子,运行处理步骤,并发送出站响应。
 *
 * 流程:
 *   1. onReceive 钩子 → 如果被阻止,停止
 *   2. 顺序步骤:sessionResolver → agentResolver → commandDetector
 *   3. beforeLLMRequest 钩子 → 如果被阻止/响应,跳过 Agent 处理
 *   4. agentProcessor → Agent 处理
 *   5. onSend 钩子 → 如果被阻止,停止
 *   6. send(outbound)
 */

import type {
  InboundMessage,
  OutboundMessage,
  PipelineResult,
  SendFn,
  SessionKey,
  SenderInfo,
} from '@aesyclaw/core/types';
import type { PipelineDependencies, PipelineState } from './middleware/types';
import { HookDispatcher } from './hook-dispatcher';
import { sessionResolver } from './middleware/session-resolver';
import { agentResolver } from './middleware/agent-resolver';
import { commandDetector } from './middleware/command-detector';
import { agentProcessor } from './middleware/agent-processor';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { requireInitialized } from '@aesyclaw/core/utils';

const logger = createScopedLogger('pipeline');

/**
 * 中央消息处理管道。
 *
 * 遵循生命周期模式:initialize() / destroy()。
 * 依赖显式注入 — 无单例导入。
 */
export class Pipeline {
  private deps: PipelineDependencies | null = null;
  hookDispatcher: HookDispatcher = new HookDispatcher();

  // ─── 生命周期 ─────────────────────────────────────────────────

  async initialize(deps: PipelineDependencies): Promise<void> {
    if (this.deps) {
      logger.warn('Pipeline 已初始化 — 跳过');
      return;
    }
    this.deps = deps;
    logger.info('Pipeline 已初始化');
  }

  destroy(): void {
    this.hookDispatcher.clearAll();
    this.deps = null;
    logger.info('Pipeline 已销毁');
  }

  // ─── 核心 API ─────────────────────────────────────────────────

  /**
   * 处理入站消息并发送响应。这是消息处理的主要入口点。
   */
  async receiveWithSend(
    message: InboundMessage,
    sessionKey: SessionKey,
    sender: SenderInfo | undefined,
    send: SendFn,
  ): Promise<void> {
    const deps = requireInitialized(this.deps, 'Pipeline');

    try {
      // 1. onReceive 钩子
      const receiveResult = await this.hookDispatcher.dispatchOnReceive(
        message,
        sessionKey,
        sender,
      );
      if (await this.handleHookResult('onReceive', receiveResult, send, undefined)) {
        return;
      }

      // 2. 中间件:sessionResolver → agentResolver → commandDetector
      let state: PipelineState = { stage: 'continue', inbound: message, sessionKey, sender };
      state = await sessionResolver(state, deps.sessionManager);
      if (state.stage === 'continue') {
        const sessionKey = state.session?.key;
        state = {
          ...state,
          sendMessage: async (outbound: OutboundMessage): Promise<boolean> =>
            await this.dispatchOnSendAndDeliver(outbound, send, sessionKey),
        };
      }

      state = await agentResolver(
        state,
        deps.agentEngine,
        deps.roleManager,
        deps.databaseManager,
        deps.llmAdapter,
      );
      if (state.stage === 'respond') {
        await this.dispatchOnSendAndDeliver(state.outbound, send, state.session?.key);
        return;
      }

      state = await commandDetector(state, deps.commandRegistry);
      if (state.stage === 'respond') {
        await this.dispatchOnSendAndDeliver(state.outbound, send, state.session?.key);
        return;
      }
      if (state.stage === 'blocked') {
        logger.info('管道被阻止', { reason: state.reason });
        return;
      }

      // 3. beforeLLMRequest 钩子(仅在 session 已解析时)
      if (state.session && state.agent && state.activeRole) {
        const beforeLLMResult = await this.hookDispatcher.dispatchBeforeLLMRequest({
          message: state.inbound,
          sessionKey: state.sessionKey,
          sender: state.sender,
          session: state.session,
          agent: state.agent,
          role: state.activeRole,
        });
        if (
          await this.handleHookResult('beforeLLMRequest', beforeLLMResult, send, state.session.key)
        ) {
          return;
        }
      }

      // 4. Agent 处理
      state = await agentProcessor(state, deps.agentEngine);
      if (state.stage === 'respond') {
        await this.dispatchOnSendAndDeliver(state.outbound, send, state.session?.key);
        return;
      }
      if (state.stage === 'blocked') {
        logger.info('管道被阻止', { reason: state.reason });
      }
    } catch (err) {
      logger.error('管道处理错误', err);
      throw err;
    }
  }

  // ─── 私有辅助方法 ───────────────────────────────────────────

  private async handleHookResult(
    hookName: string,
    result: PipelineResult,
    send: SendFn,
    sessionKey: SessionKey | undefined,
  ): Promise<boolean> {
    if (result.action === 'block') {
      logger.info(`${hookName} 钩子阻止流程`, { reason: result.reason });
      return true;
    }
    if (result.action === 'respond') {
      await this.dispatchOnSendAndDeliver({ components: result.components }, send, sessionKey);
      return true;
    }
    return false;
  }

  /**
   * 调度 onSend 钩子,如果未被阻止,则投递出站消息。
   */
  private async dispatchOnSendAndDeliver(
    outbound: OutboundMessage,
    send: SendFn,
    sessionKey?: SessionKey,
  ): Promise<boolean> {
    const sendResult = await this.hookDispatcher.dispatchOnSend({ message: outbound, sessionKey });
    if (sendResult.action === 'block') {
      logger.info('出站消息被 onSend 钩子阻止', { reason: sendResult.reason });
      return false;
    }

    const finalOutbound: OutboundMessage =
      sendResult.action === 'respond' ? { components: sendResult.components } : outbound;

    await send(finalOutbound);
    return true;
  }
}
