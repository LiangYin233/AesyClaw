import { randomUUID } from 'crypto';
import { logger, normalizeError } from '../../logger/index.js';
import { CRON_SESSION_KEY_PREFIX } from '../../constants/index.js';
import { parseTarget } from '../shared/utils.js';
import type { Services } from '../factory/ServiceFactory.js';
import type { CronJob } from '../../cron/index.js';
import type { ToolContext } from '../../tools/ToolRegistry.js';

const log = logger.child({ prefix: 'Bootstrap' });

export async function dispatchCronJob(services: Services, workspace: string, job: CronJob): Promise<void> {
  log.info(`Cron job triggered: ${job.name}`);

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
        log.error(`Invalid target format: ${target}`);
      }
    }

    await agent.processDirect(job.payload.detail, sessionKey, contextOverride);

    if (target && contextOverride?.chatId) {
      log.info(`Cron job response sent to ${target}`);
    }
  } catch (error: unknown) {
    log.error(`Cron job failed: ${normalizeError(error)}`);
  }
}
