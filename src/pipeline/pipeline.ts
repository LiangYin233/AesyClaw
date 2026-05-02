/**
 * Pipeline — 中央消息处理管道。
 *
 * 管道是唯一的控制流管理者。它接收入站消息，
 * 调度插件钩子，运行处理步骤，并发送出站响应。
 *
 * 整合后的架构：
 *   - Pipeline 持有 HookDispatcher 作为内部组件
 *   - Pipeline 暴露 hookDispatcher，供 PluginManager 注册/注销插件钩子
 *   - 所有控制流钩子（onReceive / beforeLLMRequest / onSend）由 Pipeline 统一调度
 *   - 工具钩子（beforeToolCall / afterToolCall）由 ToolAdapter 通过 HookDispatcher 调度
 *
 * 流程：
 *   1. onReceive 钩子 → 如果被阻止，停止
 *   2. 顺序步骤：sessionResolver → commandDetector
 *   3. beforeLLMRequest 钩子 → 如果被阻止/响应，跳过 Agent 处理
 *   4. agentProcessor → Agent 处理
 *   5. onSend 钩子 → 如果被阻止，停止
 *   6. send(outbound)
 */

import type { InboundMessage, OutboundMessage, SendFn } from '../core/types';
import type { SessionKey } from '../core/types';
import type {
  PipelineDependencies,
  PipelineState,
  PipelineStageResult,
  PluginHooks,
} from './middleware/types';
import { HookDispatcher } from './hook-dispatcher';
import { sessionResolver } from './middleware/session-resolver';
import { commandDetector } from './middleware/command-detector';
import { agentProcessor } from './middleware/agent-processor';
import { createScopedLogger } from '../core/logger';
import { BaseManager } from '../core/base-manager';

const logger = createScopedLogger('pipeline');

/**
 * 中央消息处理管道。
 *
 * 遵循生命周期模式：initialize() / destroy()。
 * 依赖显式注入 — 无单例导入。
 */
export class Pipeline extends BaseManager<PipelineDependencies> {
  hookDispatcher: HookDispatcher = new HookDispatcher();

  // ─── 生命周期 ─────────────────────────────────────────────────

  /**
   * 使用依赖初始化管道。
   */
  initialize(deps: PipelineDependencies): void {
    super.initialize(deps);
  }

  /**
   * 销毁管道 — 清除钩子注册和依赖。
   */
  destroy(): void {
    this.hookDispatcher.clearAll();
    super.destroy();
    logger.info('Pipeline 已销毁');
  }

  // ─── 钩子注册 ──────────────────────────────────────────────────

  /**
   * 注册插件的钩子。
   *
   * 委托给 HookDispatcher。
   *
   * @param pluginName - 唯一插件标识符（用于注销）
   * @param hooks - 包含插件提供的钩子函数的对象
   */
  register(pluginName: string, hooks: PluginHooks): void {
    this.hookDispatcher.register(pluginName, hooks);
  }

  /**
   * 注销插件的钩子。
   *
   * 如果插件没有已注册的钩子，则为空操作。
   */
  unregister(pluginName: string): void {
    this.hookDispatcher.unregister(pluginName);
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
    this.assertInitialized();
    const deps = this.getDeps();

    try {
      // 1. 调度 onReceive 钩子 — 如果被阻止，则停止
      const receiveResult = await this.hookDispatcher.dispatchOnReceive(message);
      if (receiveResult.action === 'block') {
        logger.info('消息被 onReceive 钩子阻止', {
          reason: receiveResult.reason,
        });
        return;
      }
      if (receiveResult.action === 'respond') {
        await this.dispatchOnSendAndDeliver(
          { content: receiveResult.content },
          send,
          undefined,
        );
        return;
      }

      // 2. 顺序处理步骤
      let state: PipelineState = { inbound: message };
      state = await sessionResolver(state, deps.sessionManager);

      // 在会话解析后连接 sendMessage，以便 onSend 钩子获取会话键
      state.sendMessage = async (outbound: OutboundMessage): Promise<boolean> =>
        await this.dispatchOnSendAndDeliver(outbound, send, state.session?.key);

      state = await commandDetector(state, deps.commandRegistry, deps.sessionManager);
      const afterCommand = this.checkState(state);
      if (afterCommand.stage === 'respond') {
        await this.dispatchOnSendAndDeliver(
          afterCommand.outbound,
          send,
          state.session?.key,
        );
        return;
      }
      if (afterCommand.stage === 'blocked') {
        logger.info('管道被阻止', { reason: afterCommand.reason });
        return;
      }

      // 3. 调度 beforeLLMRequest 钩子 — 由 Pipeline 统一控制
      const session = state.session;
      if (session) {
        const beforeLLMResult = await this.hookDispatcher.dispatchBeforeLLMRequest({
          message: state.inbound,
          session,
          agent: session.agent,
          role: session.activeRole,
        });

        if (beforeLLMResult.action === 'block') {
          logger.info('管道被阻止', {
            reason: beforeLLMResult.reason ?? '被 beforeLLMRequest 钩子阻止',
          });
          return;
        }
        if (beforeLLMResult.action === 'respond') {
          await this.dispatchOnSendAndDeliver(
            { content: beforeLLMResult.content },
            send,
            session.key,
          );
          return;
        }
      }

      // 4. Agent 处理
      state = await agentProcessor(state, deps.agentEngine, deps.sessionManager);
      const afterAgent = this.checkState(state);
      if (afterAgent.stage === 'respond') {
        await this.dispatchOnSendAndDeliver(
          afterAgent.outbound,
          send,
          state.session?.key,
        );
        return;
      }
      if (afterAgent.stage === 'blocked') {
        logger.info('管道被阻止', { reason: afterAgent.reason });
        return;
      }
    } catch (err) {
      logger.error('管道处理错误', err);
      throw err;
    }
  }

  // ─── 私有辅助方法 ───────────────────────────────────────────

  /**
   * 将管道状态转换为明确的阶段结果。
   */
  private checkState(state: PipelineState): PipelineStageResult {
    if (state.blocked) {
      return { stage: 'blocked', reason: state.blockReason ?? '管道被阻止' };
    }
    if (state.outbound) {
      return { stage: 'respond', outbound: state.outbound };
    }
    return { stage: 'continue', state };
  }

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
