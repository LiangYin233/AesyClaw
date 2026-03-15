import { randomUUID } from 'crypto';
import { normalizeError } from '../../errors/index.js';
import { logger } from '../../observability/index.js';
import { CRON_SESSION_KEY_PREFIX } from '../../constants/index.js';
import type { Services } from '../factory/ServiceFactory.js';
import type { CronJob } from '../../cron/index.js';

const log = logger.child('Bootstrap');

function parseTarget(to: string): { channel: string; chatId: string; messageType: 'private' | 'group' } | null {
  const match = to.match(/^([^:]+):(private|group):(.+)$/);
  if (!match) {
    return null;
  }

  return {
    channel: match[1],
    chatId: match[3],
    messageType: match[2] as 'private' | 'group'
  };
}

function buildCronExecutionPrompt(job: CronJob): string {
  return [
    '你正在执行一个定时任务。',
    '直接完成下面的任务，并把结果发送给目标用户。',
    '不要复述这段系统说明，不要解释这是定时任务或后台触发，除非任务本身要求。',
    `任务名称：${job.name}`,
    `执行指令：${job.payload.detail}`
  ].join('\n');
}

export async function dispatchCronJob(services: Services, workspace: string, job: CronJob): Promise<void> {
  log.info('Cron dispatch started', {
    jobId: job.id,
    jobName: job.name,
    target: job.payload.target
  });

  const { agentRuntime } = services;
  const sessionKey = `${CRON_SESSION_KEY_PREFIX}${job.id}:${randomUUID().slice(0, 8)}`;
  const target = job.payload.target;

  try {
    let contextOverride: { channel: string; chatId: string; messageType: 'private' | 'group' } | undefined;

    if (target) {
      const parsed = parseTarget(target);
      if (parsed) {
        contextOverride = {
          channel: parsed.channel,
          chatId: parsed.chatId,
          messageType: parsed.messageType
        };
      } else {
        log.error('Cron target invalid', { jobId: job.id, target });
      }
    }

    await agentRuntime.handleDirect(buildCronExecutionPrompt(job), {
      sessionKey,
      channel: contextOverride?.channel || 'cron',
      chatId: contextOverride?.chatId || job.id,
      messageType: contextOverride?.messageType
    }, {
      suppressOutbound: !(target && contextOverride?.channel && contextOverride?.chatId)
    });

    log.info('Cron request accepted', {
      jobId: job.id,
      target,
      willSendFinalResponse: !!(target && contextOverride?.channel && contextOverride?.chatId)
    });
  } catch (error: unknown) {
    log.error('Cron dispatch failed', {
      jobId: job.id,
      target,
      error: normalizeError(error)
    });
  }
}
