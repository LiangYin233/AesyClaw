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
import type { IHooksBus, HookCtx } from '@aesyclaw/contracts/hook';
import type { Message, OutboundSignal, SessionKey, SenderInfo, SendFn } from '@aesyclaw/core/types';
import type { PipelineDependencies } from './types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { ErrorFactory, ErrorTracker } from '@aesyclaw/core/errors';
import { AGENT_PROCESSING_BUSY_MESSAGE } from '@aesyclaw/session';

const logger = createScopedLogger('pipeline');
const errorTracker = ErrorTracker.getInstance();

const busyMessage = (): Message => ({
  components: [{ type: 'Plain', text: AGENT_PROCESSING_BUSY_MESSAGE }],
});

export class Pipeline {
  private deps: PipelineDependencies;
  readonly hooksBus: IHooksBus;

  /**
   * 创建 Pipeline 实例。
   * @param deps - 管道依赖
   */
  constructor(deps: PipelineDependencies) {
    this.deps = deps;
    this.hooksBus = this.deps.hooksBus;
  }

  /**
   * 初始化管道。
   */
  async initialize(): Promise<void> {
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
   * 完整流程：pipeline:receive（命令检测）→ 会话/Agent 解析 → 会话锁定 → pipeline:beforeLLM → Agent 处理 → 投递。
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
      // ── Step 1: 会话解析 + pipeline:receive 链 ─────────────
      const session = await this.deps.sessionManager.create(sessionKey);
      const receiveCtx: HookCtx = { message, sessionKey, sender, session };
      const receiveResult = await this.hooksBus.dispatch('pipeline:receive', receiveCtx);
      if (receiveResult.action !== 'next') {
        if (receiveResult.action === 'respond') {
          await this.message(send, receiveResult.message, sessionKey, 'hook');
        } else if (receiveResult.action === 'error') {
          logger.error('pipeline:receive 钩子执行错误', receiveResult.reason);
          await this.message(
            send,
            {
              components: [{ type: 'Plain', text: `[Hook Error] ${receiveResult.reason}` }],
            },
            sessionKey,
            'hook',
          );
        }
        return;
      }

      // ── Step 2: 角色解析 ──────────────────────────────────
      let activeRoleId: string | undefined;
      const existingAgent = this.deps.agentRegistry.getAgent(sessionKey);
      if (existingAgent?.roleId) {
        activeRoleId = existingAgent.roleId;
      } else {
        const sessionRecord = await this.deps.databaseManager.sessions.findByKey(sessionKey);
        if (sessionRecord) {
          activeRoleId = sessionRecord.role_id ?? undefined;
        }
      }

      let activeRole;
      try {
        activeRole = activeRoleId
          ? this.deps.roleManager.getRole(activeRoleId)
          : this.deps.roleManager.getDefaultRole();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Agent 创建失败：会话绑定角色不可用', {
          sessionKey,
          activeRoleId,
          error: message,
        });
        await this.message(
          send,
          { components: [{ type: 'Plain', text: `[错误: ${message}]` }] },
          session.key,
          'agent_final',
        );
        return;
      }

      // ── Step 3: Agent 创建 ────────────────────────────────
      const sessionRecord = await this.deps.databaseManager.sessions.findByKey(sessionKey);
      const agentModelId = existingAgent?.modelIdentifier ?? sessionRecord?.model_id;
      if (agentModelId === undefined) {
        const error = ErrorFactory.agent.modelNotFound('会话模型', {
          sessionKey: JSON.stringify(sessionKey),
        });
        errorTracker.track(error, { operation: 'pipeline:createAgent', sessionKey });
        logger.error('Agent 创建失败：会话模型缺失', {
          sessionKey,
          error: error.message,
        });
        await this.message(
          send,
          { components: [{ type: 'Plain', text: `[错误: ${error.message}]` }] },
          session.key,
          'agent_final',
        );
        return;
      }

      const agent = this.deps.agentFactory.create(session, agentModelId);
      await agent.setRole(activeRole);

      // ── Step 4: 会话锁定 ──────────────────────────────────
      if (!session.lock()) {
        await this.message(send, busyMessage(), session.key);
        return;
      }

      let streamed = false;

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
            await this.message(send, beforeResult.message, session.key, 'hook');
          } else if (beforeResult.action === 'error') {
            logger.error('pipeline:beforeLLM 钩子执行错误', beforeResult.reason);
            await this.message(
              send,
              {
                components: [{ type: 'Plain', text: `[Hook Error] ${beforeResult.reason}` }],
              },
              session.key,
              'hook',
            );
          }
          return;
        }

        const transformedMessage = beforeCtx.message;

        // 流式事件回调：直接推送给 channel，不经过 pipeline:send 钩子链
        const onStream = (signal: OutboundSignal): void => {
          streamed = true;
          void send(signal).catch((err) => {
            logger.error('流式事件投递失败', err);
          });
        };

        const outbound = await agent.process(
          transformedMessage,
          async (msg) => {
            return await this.message(send, msg, session.key, 'agent_send_message', true);
          },
          undefined,
          onStream,
        );

        // session 未被外部取消时才投递结果。
        // 如果已走流式事件，最终 outbound 只用于持久化，不能再次投递给 channel，
        // 否则客户端会同时收到 chunk 流和最终完整文本，显示重复回复。
        if (session.isLocked && !streamed) {
          await this.message(send, outbound, session.key, 'agent_final');
        }
      } finally {
        // 强制 flush：如果流式已开始但 done 信号可能未到（如 Agent 取消），
        // 确保非流式频道的 chunk buffer 被 flush。
        if (streamed) {
          void send({
            kind: 'done',
            session: session.key,
          }).catch((err) => {
            logger.error('强制 flush 非流式频道 buffer 失败', err);
          });
        }
        session.unlock();
      }
    } catch (err) {
      logger.error('管道处理错误', err);
      throw err;
    }
  }

  /**
   * 发送 message 信号 — 运行 pipeline:send 链后包装为 OutboundSignal 投递。
   */
  private async message(
    send: SendFn,
    outbound: Message,
    sessionKey: SessionKey,
    source?: 'agent_final' | 'command' | 'hook' | 'agent_send_message',
    intermediate?: boolean,
  ): Promise<boolean> {
    const sendCtx: HookCtx = {
      message: outbound,
      sessionKey: sessionKey,
    };
    const sendResult = await this.hooksBus.dispatch('pipeline:send', sendCtx);
    if (sendResult.action === 'block') {
      logger.info('出站消息被 pipeline:send 链阻断');
      return false;
    }
    if (sendResult.action === 'error') {
      logger.error('pipeline:send 钩子执行错误', sendResult.reason);
      // 不阻断发送，继续用原消息
    }

    const finalOutbound: Message = sendResult.action === 'respond' ? sendResult.message : outbound;

    await send({
      kind: 'message',
      session: sessionKey,
      content: finalOutbound,
      intermediate,
      source,
    });
    return true;
  }
}
