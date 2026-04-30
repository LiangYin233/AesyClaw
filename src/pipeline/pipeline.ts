/**
 * Pipeline — 带有顺序步骤和钩子调度的消息处理管道。
 *
 * 管道是中央消息处理编排器。它接收
 * 入站消息，调度插件钩子，运行处理步骤，
 * 并发送出站响应。
 *
 * 流程：
 *   1. HookDispatcher.dispatchOnReceive(message) → 如果被阻止，停止
 *   2. 顺序步骤：sessionResolver → commandDetector → agentProcessor
 *   3. 如果 state.blocked，停止
 *   4. HookDispatcher.dispatchOnSend(outbound) → 如果被阻止，停止
 *   5. send(outbound)
 *
 */

import type { InboundMessage, OutboundMessage, SendFn } from '../core/types';
import type { SessionKey } from '../core/types';
import type { PipelineDependencies, PipelineState } from './middleware/types';
import { HookDispatcher } from './hook-dispatcher';
import { sessionResolver } from './middleware/session-resolver';
import { commandDetector } from './middleware/command-detector';
import { agentProcessor } from './middleware/agent-processor';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('pipeline');

/**
 * 中央消息处理管道。
 *
 * 遵循生命周期模式：initialize() / destroy()。
 * 依赖显式注入 — 无单例导入。
 */
export class Pipeline {
  private hookDispatcher: HookDispatcher = new HookDispatcher();
  private deps: PipelineDependencies | null = null;
  private initialized = false;

  // ─── 生命周期 ─────────────────────────────────────────────────

  /**
   * 使用依赖初始化管道。
   */
  initialize(deps: PipelineDependencies): void {
    if (this.initialized) {
      logger.warn('Pipeline 已初始化 — 跳过');
      return;
    }

    this.deps = deps;
    this.initialized = true;
    logger.info('Pipeline 已初始化');
  }

  /**
   * 销毁管道 — 清除钩子注册。
   */
  destroy(): void {
    this.deps = null;
    this.hookDispatcher = new HookDispatcher();
    this.initialized = false;
    logger.info('Pipeline 已销毁');
  }

  // ─── 核心 API ─────────────────────────────────────────────────

  /**
   * 处理入站消息并发送响应。
   *
   * 这是消息处理的主要入口点。
   *
   * @param message - 来自频道的入站消息
   * @param send - 发送出站响应的函数
   */
  async receiveWithSend(message: InboundMessage, send: SendFn): Promise<void> {
    if (!this.initialized || !this.deps) {
      logger.error('Pipeline 未初始化 — 无法处理消息');
      return;
    }

    try {
      // 1. 调度 onReceive 钩子 — 如果被阻止，则停止
      const receiveResult = await this.hookDispatcher.dispatchOnReceive(message);
      if (receiveResult.action === 'block') {
        logger.info('消息被 onReceive 钩子阻止', {
          reason: receiveResult.reason,
        });
        return;
      }

      // 如果钩子提供了响应，则直接发送（跳过处理步骤）
      if (receiveResult.action === 'respond') {
        const outbound: OutboundMessage = {
          content: (receiveResult as { action: 'respond'; content: string }).content,
        };
        await this.dispatchOnSendAndDeliver(outbound, send);
        return;
      }

      // 2. 执行顺序处理步骤
      let state: PipelineState = {
        inbound: message,
      };

      state = await sessionResolver(state, this.deps.sessionManager);

      // 在会话解析后连接 sendMessage，以便 onSend 钩子获取会话键
      state.sendMessage = async (outbound: OutboundMessage): Promise<boolean> =>
        await this.dispatchOnSendAndDeliver(outbound, send, state.session?.key);
      state = await commandDetector(state, this.deps.commandRegistry, this.deps.sessionManager);

      // 如果 commandDetector 设置了出站消息，则跳过 Agent 处理
      if (!state.outbound) {
        state = await agentProcessor(
          state,
          this.deps.agentEngine,
          this.hookDispatcher,
          this.deps.sessionManager,
        );
      }

      // 3. 处理后：如果状态被阻止，则停止
      if (state.blocked) {
        logger.info('管道被阻止', {
          reason: state.blockReason,
        });
        return;
      }

      // 4. 如果生成了出站消息，则调度 onSend 并投递
      if (state.outbound) {
        await this.dispatchOnSendAndDeliver(state.outbound, send, state.session?.key);
      }
    } catch (err) {
      logger.error('管道处理错误', err);
      throw err;
    }
  }

  /**
   * 获取用于插件钩子注册的钩子调度器。
   */
  getHookDispatcher(): HookDispatcher {
    return this.hookDispatcher;
  }

  // ─── 私有辅助方法 ───────────────────────────────────────────

  /**
   * 调度 onSend 钩子，如果未被阻止，则投递出站消息。
   */
  private async dispatchOnSendAndDeliver(
    outbound: OutboundMessage,
    send: SendFn,
    sessionKey?: SessionKey,
  ): Promise<boolean> {
    const sendResult = await this.hookDispatcher.dispatchOnSend({ message: outbound, sessionKey });
    if (sendResult.action === 'block') {
      logger.info('出站消息被 onSend 钩子阻止', {
        reason: sendResult.reason,
      });
      return false;
    }

    // 如果钩子响应，则使用该内容替代
    const finalOutbound: OutboundMessage =
      sendResult.action === 'respond'
        ? {
            content: sendResult.content,
            ...(sendResult.attachments ? { attachments: sendResult.attachments } : {}),
          }
        : outbound;

    await send(finalOutbound);
    return true;
  }
}
