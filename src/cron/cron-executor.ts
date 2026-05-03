/** 定时任务执行器 — 记录定时任务运行并将任务注入管道。 */

import type {
  CronJobRecord,
  InboundMessage,
  OutboundMessage,
  SessionKey,
} from '@aesyclaw/core/types';
import { parseSerializedSessionKey } from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';
import type { CronRunsRepository } from '@aesyclaw/core/database/database-manager';
import type { Pipeline } from '@aesyclaw/pipeline/pipeline';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('cron');

export type CronExecutorDependencies = {
  cronRuns: CronRunsRepository;
  pipeline: Pick<Pipeline, 'receiveWithSend'>;
  send: (sessionKey: SessionKey, message: OutboundMessage) => Promise<void>;
};

export type CronExecutionSessionKeys = {
  context: SessionKey;
  target: SessionKey;
};

/**
 * 定时任务执行器 — 记录定时任务运行并将任务注入管道。
 */
export class CronExecutor {
  constructor(private readonly dependencies: CronExecutorDependencies) {}

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
    const runId = await this.dependencies.cronRuns.create({ jobId: job.id });
    try {
      const targetSessionKey = sessionKeys?.target ?? parseSerializedSessionKey(job.sessionKey);
      const contextSessionKey = sessionKeys?.context ?? createCronContextSessionKey(job.id);
      const outboundMessages: OutboundMessage[] = [];
      const inbound: InboundMessage = {
        components: [{ type: 'Plain', text: job.prompt }],
      };

      await this.dependencies.pipeline.receiveWithSend(
        inbound,
        contextSessionKey,
        undefined,
        async (message) => {
          await this.dependencies.send(targetSessionKey, message);
          outboundMessages.push(message);
        },
      );

      const result = formatResult(outboundMessages);
      await this.dependencies.cronRuns.markCompleted(runId, result);
      logger.info('定时任务已完成', { jobId: job.id, runId });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.dependencies.cronRuns.markFailed(runId, message);
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
export function formatResult(messages: OutboundMessage[]): string {
  if (messages.length === 0) {
    return '定时任务已完成，但无出站响应。';
  }
  return messages.map((message) => getMessageText(message)).join('\n');
}
