/** 定时任务执行器 — 记录定时任务运行并将任务注入管道。 */

import {
  getMessageText,
  parseSerializedSessionKey,
  type CronJobRecord,
  type Message,
  type SessionKey,
} from '@aesyclaw/core/types';
import type { CronRunsRepository } from '@aesyclaw/core/database/database-manager';
import type { Pipeline } from '@aesyclaw/pipeline/pipeline';
import type { SessionManager } from '@aesyclaw/session';
import { createPersistedAssistantMessage } from '@aesyclaw/agent/agent-types';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('cron');

export type CronExecutionSessionKeys = {
  context: SessionKey;
  target: SessionKey;
};

/**
 * 定时任务执行器 — 记录定时任务运行并将任务注入管道。
 */
export class CronExecutor {
  constructor(
    private cronRuns: CronRunsRepository,
    private pipeline: Pick<Pipeline, 'receiveWithSend'>,
    private send: (sessionKey: SessionKey, message: Message) => Promise<void>,
    private sessionManager: SessionManager,
  ) {}

  /**
   * 执行单个定时任务。
   *
   * 创建运行记录、构造入站消息、通过管道处理、
   * 并将结果标记为完成或失败。
   *
   * @param job - 要执行的定时任务
   * @param sessionKeys - 可选的上下文和目标会话键覆盖
   * @returns 执行结果的格式化字符串
   */
  async execute(job: CronJobRecord, sessionKeys?: CronExecutionSessionKeys): Promise<string> {
    const runId = await this.cronRuns.create({ jobId: job.id });
    try {
      const targetSessionKey = sessionKeys?.target ?? parseSerializedSessionKey(job.sessionKey);
      const contextSessionKey = sessionKeys?.context ?? createCronContextSessionKey(job.id);
      const outboundMessages: Message[] = [];
      const inbound: Message = {
        components: [{ type: 'Plain', text: job.prompt }],
      };

      await this.pipeline.receiveWithSend(
        inbound,
        contextSessionKey,
        undefined,
        async (message) => {
          await this.send(targetSessionKey, message);
          outboundMessages.push(message);
        },
      );

      if (outboundMessages.length > 0) {
        const session = await this.sessionManager.create(targetSessionKey);
        for (const msg of outboundMessages) {
          const text = getMessageText(msg).trim();
          if (text) await session.add(createPersistedAssistantMessage(text));
        }
      }

      const result = formatResult(outboundMessages);
      await this.cronRuns.markCompleted(runId, result);
      logger.info('定时任务已完成', { jobId: job.id, runId });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.cronRuns.markFailed(runId, message);
      logger.error('定时任务失败', { jobId: job.id, runId, error: message });
      throw err;
    }
  }
}

/**
 * 为定时任务创建内部上下文会话键。
 *
 * @param jobId - 定时任务 ID
 * @returns 频道为 'cron'、类型为 'job' 的会话键
 */
export function createCronContextSessionKey(jobId: string): SessionKey {
  return {
    channel: 'cron',
    type: 'job',
    chatId: jobId,
  };
}

/**
 * 将出站消息数组格式化为执行结果字符串。
 *
 * @param messages - 管道执行产生的出站消息
 * @returns 合并后的文本结果
 */
export function formatResult(messages: Message[]): string {
  if (messages.length === 0) {
    return '定时任务已完成，但无出站响应。';
  }
  return messages.map((message) => getMessageText(message)).join('\n');
}
