/**
 * Pipeline — 消息处理管道。
 *
 * 负责端到端的消息处理流程：
 * 1. pipeline:receive 链派发
 * 2. 会话与 Agent 解析
 * 3. 命令检测与执行
 * 4. pipeline:beforeLLM 链派发与 Agent 处理
 * 5. 结果投递（含 pipeline:send 链）
 */
import type { IHooksBus, HookCtx } from '@aesyclaw/hook';
import {
  getMessageText,
  type Message,
  type SessionKey,
  type SenderInfo,
  type SendFn,
} from '@aesyclaw/core/types';
import type { PipelineDependencies } from './types';
import { Agent } from '@aesyclaw/agent/agent';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { AGENT_PROCESSING_BUSY_MESSAGE } from '@aesyclaw/session';
import { createTimeInjectHook } from './hooks/time-inject';
import { createAutoCompactHook } from './hooks/auto-compact';

const logger = createScopedLogger('pipeline');

const busyMessage = (): Message => ({
  components: [{ type: 'Plain', text: AGENT_PROCESSING_BUSY_MESSAGE }],
});

export class Pipeline {
  private deps: PipelineDependencies;
  readonly hooksBus: IHooksBus;

  /**
   * 创建 Pipeline 实例。
   * @param deps - 管道所需的基础设施与 Agent 处理服务
   */
  constructor(deps: PipelineDependencies) {
    this.deps = deps;
    this.hooksBus = this.deps.hooksBus;
  }

  /**
   * 初始化管道，注册内置 Hook。
   */
  async initialize(): Promise<void> {
    this.hooksBus.register(
      createAutoCompactHook(this.deps.llmAdapter, this.deps.compressionThreshold),
    );
    this.hooksBus.register(createTimeInjectHook());
    logger.info('Pipeline 已初始化');
  }

  /**
   * 销毁管道，清除所有已注册的钩子。
   */
  destroy(): void {
    this.hooksBus.clear();
    logger.info('Pipeline 已销毁');
  }

  /**
   * 接收消息并通过管道处理。
   *
   * 完整流程：pipeline:receive → 会话/Agent 解析 → 命令检测 → pipeline:beforeLLM → Agent 处理 → 投递。
   * @param message - 传入的消息
   * @param sessionKey - 会话键
   * @param sender - 发送者信息（可选）
   * @param send - 出站消息投递函数
   */
  async receiveWithSend(
    message: Message,
    sessionKey: SessionKey,
    sender: SenderInfo | undefined,
    send: SendFn,
  ): Promise<void> {
    try {
      // ── Step 1: pipeline:receive 链 ───────────────────────
      const receiveCtx: HookCtx = { message, sessionKey, sender };
      const receiveResult = await this.hooksBus.dispatch('pipeline:receive', receiveCtx);
      if (receiveResult.action !== 'next') {
        if (receiveResult.action === 'respond') {
          await this.deliver(send, receiveResult.message, sessionKey);
        }
        return;
      }

      // ── Step 2: 会话与 Agent 解析 ────────────────────────
      const session = await this.deps.sessionManager.create(sessionKey);

      const activeRoleId = await Agent.resolveActiveRoleId(
        { sessionKey },
        { databaseManager: this.deps.databaseManager, agentRegistry: this.deps.agentRegistry },
      );

      const activeRole = activeRoleId
        ? this.deps.roleManager.getRole(activeRoleId)
        : this.deps.roleManager.getDefaultRole();

      const agent = new Agent({
        session,
        llmAdapter: this.deps.llmAdapter,
        roleManager: this.deps.roleManager,
        skillManager: this.deps.skillManager,
        toolRegistry: this.deps.toolRegistry,
        hooksBus: this.hooksBus,
        compressionThreshold: this.deps.compressionThreshold,
        registry: this.deps.agentRegistry,
      });
      await agent.setRole(activeRole);

      // ── Step 3: 命令检测 ─────────────────────────────────
      const text = getMessageText(message);
      const resolved = this.deps.commandRegistry.resolve(text);

      if (resolved) {
        if (session.isLocked && !resolved.command.allowDuringAgentProcessing) {
          await this.deliver(send, busyMessage(), session.key);
          return;
        }

        const result = await this.deps.commandRegistry.executeResolved(resolved, { sessionKey });
        await this.deliver(send, { components: [{ type: 'Plain', text: result }] }, session.key);
        return;
      }

      // ── Step 4: 非命令锁定 ───────────────────────────────
      if (!session.lock()) {
        await this.deliver(send, busyMessage(), session.key);
        return;
      }

      try {
        // ── Step 5: pipeline:beforeLLM 链与 Agent 处理 ─────
        const beforeCtx: HookCtx = {
          message,
          sessionKey,
          sender,
          session,
          agent,
          role: activeRole,
        };
        const beforeResult = await this.hooksBus.dispatch('pipeline:beforeLLM', beforeCtx);
        if (beforeResult.action !== 'next') {
          if (beforeResult.action === 'respond') {
            await this.deliver(send, beforeResult.message, session.key);
          }
          return;
        }

        const transformedMessage = beforeCtx.message;

        const outbound = await agent.process(transformedMessage, async (msg) => {
          return await this.deliver(send, msg, session.key);
        });

        // session 未被外部取消时才投递结果
        if (session.isLocked) {
          await this.deliver(send, outbound, session.key);
        }
      } finally {
        session.unlock();
      }
    } catch (err) {
      logger.error('管道处理错误', err);
      throw err;
    }
  }

  /**
   * 统一出站投递 — 运行 pipeline:send 链后调用 send。
   *
   * @returns true 表示成功投递，false 表示被阻断
   */
  private async deliver(
    send: SendFn,
    outbound: Message,
    sessionKey?: SessionKey,
  ): Promise<boolean> {
    const sendCtx: HookCtx = {
      message: outbound,
      sessionKey: sessionKey ?? { channel: '', type: '', chatId: '' },
    };
    const sendResult = await this.hooksBus.dispatch('pipeline:send', sendCtx);
    if (sendResult.action === 'block') {
      logger.info('出站消息被 pipeline:send 链阻断');
      return false;
    }

    const finalOutbound: Message = sendResult.action === 'respond' ? sendResult.message : outbound;

    await send(finalOutbound);
    return true;
  }
}
