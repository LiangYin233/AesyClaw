import { randomUUID } from 'crypto';
import { logger, normalizeError } from '../../logger/index.js';
import { CRON_SESSION_KEY_PREFIX } from '../../constants/index.js';
import { parseTarget } from '../shared/utils.js';
import type { Services } from '../factory/ServiceFactory.js';
import type { CronJob } from '../../cron/index.js';
import type { ToolContext } from '../../tools/ToolRegistry.js';

const log = logger.child({ prefix: 'Bootstrap' });

export async function dispatchCronJob(services: Services, workspace: string, job: CronJob): Promise<void> {
  log.info('Cron dispatch started', {
    jobId: job.id,
    jobName: job.name,
    target: job.payload.target
  });

  const { eventBus, pluginManager, agent } = services;
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

    const response = await agent.processDirect(job.payload.detail, sessionKey, contextOverride);

    if (target && contextOverride?.channel && contextOverride?.chatId && response.trim()) {
      const outboundMessage = await pluginManager.applyOnResponse({
        channel: contextOverride.channel,
        chatId: contextOverride.chatId,
        content: response,
        messageType: contextOverride.messageType
      });

      if (outboundMessage) {
        await eventBus.publishOutbound(outboundMessage);
      }

      log.info('Cron dispatch completed', {
        jobId: job.id,
        target,
        delivered: !!outboundMessage
      });
    }
  } catch (error: unknown) {
    log.error('Cron dispatch failed', {
      jobId: job.id,
      target,
      error: normalizeError(error)
    });
  }
}
