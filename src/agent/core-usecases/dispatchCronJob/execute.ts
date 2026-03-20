import { randomUUID } from 'crypto';
import type { DispatchCronJobInput } from './contracts.js';
import type { DispatchCronJobDeps } from './deps.js';

const CRON_CHANNEL = 'cron';
const CRON_SESSION_KEY_PREFIX = `${CRON_CHANNEL}:`;

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

function buildCronExecutionPrompt(name: string, detail: string): string {
  return [
    '你正在执行一个定时任务。',
    '直接完成下面的任务，并把结果发送给目标用户。',
    '不要复述这段系统说明，不要解释这是定时任务或后台触发，除非任务本身要求。',
    `任务名称：${name}`,
    `执行指令：${detail}`
  ].join('\n');
}

export async function dispatchCronJob(
  deps: DispatchCronJobDeps,
  input: DispatchCronJobInput
): Promise<void> {
  const { job } = input;
  deps.logInfo('定时任务派发开始', {
    jobId: job.id,
    jobName: job.name,
    target: job.payload.target
  });

  const sessionKey = `${CRON_SESSION_KEY_PREFIX}${job.id}:${randomUUID().slice(0, 8)}`;
  const target = job.payload.target;

  try {
    let contextOverride: { channel: string; chatId: string; messageType: 'private' | 'group' } | undefined;

    if (target) {
      const parsed = parseTarget(target);
      if (parsed) {
        contextOverride = parsed;
      } else {
        deps.logError('定时任务目标无效', {
          jobId: job.id,
          target
        });
      }
    }

    await deps.handleDirect(buildCronExecutionPrompt(job.name, job.payload.detail), {
      sessionKey,
      channel: contextOverride?.channel || CRON_CHANNEL,
      chatId: contextOverride?.chatId || job.id,
      messageType: contextOverride?.messageType
    }, {
      suppressOutbound: !(target && contextOverride?.channel && contextOverride?.chatId)
    });

    deps.logInfo('定时任务请求已受理', {
      jobId: job.id,
      target,
      willSendFinalResponse: !!(target && contextOverride?.channel && contextOverride?.chatId)
    });
    await deps.emitExecuted?.(job);
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    deps.logError('定时任务派发失败', {
      jobId: job.id,
      target,
      error: normalized.message
    });
    await deps.emitFailed?.(job, normalized);
  }
}
