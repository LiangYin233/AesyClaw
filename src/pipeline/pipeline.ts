/**
 * Pipeline — 消息处理管道（精简重写版）。
 *
 * 相比旧版：
 * - 无 State 机（删除了 PipelineState 判别联合及 3 个变体）
 * - 无中间件层（删除了 3 个独立 middleware 文件）
 * - receiveWithSend 内 5 个顺序步骤 + 早期 return
 * - deliver 辅助函数统一所有出站路径
 * - PipelineDependencies 从 8 项减为 7 项（删除 hookDispatcher）
 */

import type {
  InboundMessage,
  OutboundMessage,
  SessionKey,
  SenderInfo,
  SendFn,
} from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';
import type { PipelineDependencies } from './types';
import { HookDispatcher } from './hook-dispatcher';
import { Agent } from '@aesyclaw/agent/agent';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { requireInitialized } from '@aesyclaw/core/utils';
import { AGENT_PROCESSING_BUSY_MESSAGE } from '@aesyclaw/session';

const logger = createScopedLogger('pipeline');

export class Pipeline {
  private deps: PipelineDependencies | null = null;
  hooks: HookDispatcher = new HookDispatcher();

  async initialize(deps: PipelineDependencies): Promise<void> {
    if (this.deps) {
      logger.warn('Pipeline 已初始化 — 跳过');
      return;
    }
    this.deps = deps;
    logger.info('Pipeline 已初始化');
  }

  destroy(): void {
    this.hooks.clearAll();
    this.deps = null;
    logger.info('Pipeline 已销毁');
  }

  async receiveWithSend(
    message: InboundMessage,
    sessionKey: SessionKey,
    sender: SenderInfo | undefined,
    send: SendFn,
  ): Promise<void> {
    const deps = requireInitialized(this.deps, 'Pipeline');

    try {
      // ── Step 1: onReceive 钩子 ───────────────────────────
      const receiveResult = await this.hooks.onReceive({ message, sessionKey, sender });
      if (receiveResult.action !== 'continue') {
        if (receiveResult.action === 'respond') {
          await this.deliver(send, { components: receiveResult.components }, sessionKey);
        }
        return;
      }

      // ── Step 2: 会话与 Agent 解析 ────────────────────────
      if (sessionKey.channel === 'cron' && sessionKey.type === 'job') {
        const existing = deps.sessionManager.get(sessionKey);
        if (existing) await existing.clear();
      }

      const session = await deps.sessionManager.create(sessionKey);

      const activeRoleId =
        (await deps.databaseManager.roleBindings.getActiveRole(session.sessionId)) ?? undefined;

      const activeRole = activeRoleId
        ? deps.roleManager.getRole(activeRoleId)
        : deps.roleManager.getDefaultRole();

      const agent = new Agent({
        session,
        llmAdapter: deps.llmAdapter,
        roleManager: deps.roleManager,
        skillManager: deps.skillManager,
        toolRegistry: deps.toolRegistry,
        hookDispatcher: this.hooks,
      });
      await agent.setRole(activeRole);

      // ── Step 3: 命令检测 ─────────────────────────────────
      const text = getMessageText(message);
      const resolved = deps.commandRegistry.resolve(text);
      const isBusy = session.isLocked;

      if (isBusy && !resolved?.command.allowDuringAgentProcessing) {
        await this.deliver(
          send,
          { components: [{ type: 'Plain', text: AGENT_PROCESSING_BUSY_MESSAGE }] },
          session.key,
        );
        return;
      }

      if (resolved) {
        const result = await deps.commandRegistry.executeResolved(resolved, { sessionKey });
        await this.deliver(send, { components: [{ type: 'Plain', text: result }] }, session.key);
        return;
      }

      // ── Step 4: beforeLLM 钩子 ───────────────────────────
      if (session !== undefined && agent !== undefined && activeRole !== undefined) {
        const beforeLLMResult = await this.hooks.beforeLLM({
          message,
          sessionKey,
          sender,
          session,
          agent,
          role: activeRole,
        });
        if (beforeLLMResult.action !== 'continue') {
          if (beforeLLMResult.action === 'respond') {
            await this.deliver(send, { components: beforeLLMResult.components }, session.key);
          }
          return;
        }
      }

      // ── Step 5: Agent 处理（session.lock/unlock） ────────
      if (!session.lock()) {
        await this.deliver(
          send,
          { components: [{ type: 'Plain', text: AGENT_PROCESSING_BUSY_MESSAGE }] },
          session.key,
        );
        return;
      }

      try {
        const outbound = await agent.process(message, async (msg) => {
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
   * 统一出站投递 — 运行 onSend 钩子后调用 send。
   *
   * @returns true 表示成功投递，false 表示被 onSend 阻止
   */
  private async deliver(
    send: SendFn,
    outbound: OutboundMessage,
    sessionKey?: SessionKey,
  ): Promise<boolean> {
    const sendResult = await this.hooks.onSend({ message: outbound, sessionKey });
    if (sendResult.action === 'block') {
      logger.info('出站消息被 onSend 钩子阻止');
      return false;
    }

    const finalOutbound: OutboundMessage =
      sendResult.action === 'respond' ? { components: sendResult.components } : outbound;

    await send(finalOutbound);
    return true;
  }
}
