/** Cron executor — records cron runs and injects jobs into the pipeline. */

import type { CronJobRecord, InboundMessage, OutboundMessage, SessionKey } from '../core/types';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('cron');

export interface CronRunRepositoryLike {
  create(params: { jobId: string }): Promise<string>;
  markCompleted(runId: string, result: string): Promise<void>;
  markFailed(runId: string, error: string): Promise<void>;
  findRunning(): Promise<Array<{ id: string }>>;
  markAbandoned(runIds: string[]): Promise<void>;
}

export interface CronPipelineLike {
  receiveWithSend(
    message: InboundMessage,
    send: (message: OutboundMessage) => Promise<void>,
  ): Promise<void>;
}

export interface CronExecutorDependencies {
  cronRuns: CronRunRepositoryLike;
  pipeline: CronPipelineLike;
}

export class CronExecutor {
  constructor(private readonly dependencies: CronExecutorDependencies) {}

  async execute(job: CronJobRecord): Promise<string> {
    const runId = await this.dependencies.cronRuns.create({ jobId: job.id });
    try {
      const sessionKey = parseSessionKey(job.sessionKey);
      const outboundMessages: OutboundMessage[] = [];
      const inbound: InboundMessage = {
        sessionKey,
        content: job.prompt,
        rawEvent: { cronJobId: job.id, cronRunId: runId },
      };

      await this.dependencies.pipeline.receiveWithSend(inbound, async (message) => {
        outboundMessages.push(message);
      });

      const result = formatResult(outboundMessages);
      await this.dependencies.cronRuns.markCompleted(runId, result);
      logger.info('Cron job completed', { jobId: job.id, runId });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.dependencies.cronRuns.markFailed(runId, message);
      logger.error('Cron job failed', { jobId: job.id, runId, error: message });
      throw err;
    }
  }
}

export function parseSessionKey(value: string): SessionKey {
  const parsed: unknown = JSON.parse(value);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>).channel !== 'string' ||
    typeof (parsed as Record<string, unknown>).type !== 'string' ||
    typeof (parsed as Record<string, unknown>).chatId !== 'string'
  ) {
    throw new Error('Invalid cron session key');
  }

  const record = parsed as Record<string, string>;
  return {
    channel: record.channel,
    type: record.type,
    chatId: record.chatId,
  };
}

export function formatResult(messages: OutboundMessage[]): string {
  if (messages.length === 0) {
    return 'Cron job completed without outbound response.';
  }
  return messages.map((message) => message.content).join('\n');
}
