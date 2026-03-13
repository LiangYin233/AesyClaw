import { randomUUID } from 'crypto';
import { logger, normalizeError } from '../../logger/index.js';
import { CRON_SESSION_KEY_PREFIX } from '../../constants/index.js';
import type { Services } from '../factory/ServiceFactory.js';
import type { CronJob } from '../../cron/index.js';
import type { ToolContext } from '../../tools/ToolRegistry.js';

const log = logger.child({ prefix: 'Bootstrap' });

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

export async function dispatchCronJob(services: Services, workspace: string, job: CronJob): Promise<void> {
  log.info('Cron dispatch started', {
    jobId: job.id,
    jobName: job.name,
    target: job.payload.target
  });

  const { eventBus, agent } = services;
  const sessionKey = `${CRON_SESSION_KEY_PREFIX}${job.id}:${randomUUID().slice(0, 8)}`;
  const target = job.payload.target;

  try {
    let contextOverride: ToolContext | undefined;

    if (target) {
      const parsed = parseTarget(target);
      if (parsed) {
        contextOverride = {
          workspace,
          eventBus,
          channel: parsed.channel,
          chatId: parsed.chatId,
          messageType: parsed.messageType,
          source: 'cron'
        };
      } else {
        log.error('Cron target invalid', { jobId: job.id, target });
      }
    }

    await agent.processDirect(job.payload.detail, sessionKey, contextOverride, {
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
