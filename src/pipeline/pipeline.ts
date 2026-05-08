/** Pipeline — 消息处理管道。 */

import type {
  Message,
  SessionKey,
  SenderInfo,
  SendFn,
} from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';
import type { PipelineDependencies } from './types';
import { HookDispatcher } from './hook-dispatcher';
import { Agent } from '@aesyclaw/agent/agent';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { AGENT_PROCESSING_BUSY_MESSAGE } from '@aesyclaw/session';

const logger = createScopedLogger('pipeline');

export class Pipeline {
  private deps: PipelineDependencies;
  hooks: HookDispatcher = new HookDispatcher();

  constructor(deps: PipelineDependencies) {
    this.deps = deps;
  }

  async initialize(): Promise<void> {
    logger.info('Pipeline 已初始化');
  }

  destroy(): void {
    this.hooks.clearAll();
    logger.info('Pipeline 已销毁');
  }

  async receiveWithSend(
    message: Message,
    sessionKey: SessionKey,
    sender: SenderInfo | undefined,
    send: SendFn,
  ): Promise<void> {
    const deps = this.deps;

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
        compressionThreshold: deps.compressionThreshold,
      });
      await agent.setRole(activeRole);

      // ── Step 3: 命令检测 ─────────────────────────────────
      const text = getMessageText(message);
      const resolved = deps.commandRegistry.resolve(text);

      if (resolved) {
        if (session.isLocked && !resolved.command.allowDuringAgentProcessing) {
          await this.deliver(
            send,
            { components: [{ type: 'Plain', text: AGENT_PROCESSING_BUSY_MESSAGE }] },
            session.key,
          );
          return;
        }

        const result = await deps.commandRegistry.executeResolved(resolved, { sessionKey });
        await this.deliver(send, { components: [{ type: 'Plain', text: result }] }, session.key);
        return;
      }

      // ── Step 4: 非命令锁定 ───────────────────────────────
      if (!session.lock()) {
        await this.deliver(
          send,
          { components: [{ type: 'Plain', text: AGENT_PROCESSING_BUSY_MESSAGE }] },
          session.key,
        );
        return;
      }

      try {
        // ── Step 5: beforeLLM 钩子与 Agent 处理 ────────────
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
    outbound: Message,
    sessionKey?: SessionKey,
  ): Promise<boolean> {
    const sendResult = await this.hooks.onSend({ message: outbound, sessionKey });
    if (sendResult.action === 'block') {
      logger.info('出站消息被 onSend 钩子阻止');
      return false;
    }

    const finalOutbound: Message =
      sendResult.action === 'respond' ? { components: sendResult.components } : outbound;

    await send(finalOutbound);
    return true;
  }
}
