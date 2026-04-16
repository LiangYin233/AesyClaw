import { createTemporarySession, removeTemporarySession } from '@/agent/session/session-runtime.js';
import { cronJobScheduler } from '@/platform/db/cron-scheduler.js';
import { cronService } from '@/platform/db/cron-service.js';
import type { CronJobRecord } from '@/platform/db/repositories/cron-job-repository.js';
import { logger } from '@/platform/observability/logger.js';

export interface CreateCronJobRequest {
  chatId: string;
  name: string;
  cronExpression: string;
  prompt: string;
}

export async function createCronJob(input: CreateCronJobRequest): Promise<CronJobRecord> {
  const job = cronService.createJob(input);

  logger.info({ id: job.id, name: job.name }, 'Cron job created with prompt');

  return job;
}

export async function listCronJobs(chatId?: string): Promise<CronJobRecord[]> {
  return cronService.listJobs(chatId);
}

export async function deleteCronJob(id: string): Promise<boolean> {
  const result = cronService.deleteJob(id);
  if (result) {
    logger.info({ id }, 'Cron job deleted via tool');
  }
  return result;
}

export async function toggleCronJob(id: string, enabled: boolean): Promise<CronJobRecord | null> {
  const job = cronService.toggleJob(id, enabled);
  if (job) {
    logger.info({ id, enabled }, 'Cron job toggled via tool');
  }
  return job;
}

export async function updateCronJob(
  id: string,
  updates: Partial<Pick<CronJobRecord, 'name' | 'cronExpression' | 'prompt'>>
): Promise<CronJobRecord | null> {
  const job = cronService.updateJob(id, updates);
  if (job) {
    logger.info({ id }, 'Cron job updated via tool');
  }
  return job;
}

export class PromptExecutor {
  async execute(job: CronJobRecord): Promise<void> {
    if (!job.prompt) {
      logger.warn({ jobId: job.id }, 'Cron job has no prompt, skipping execution');
      return;
    }

    logger.info(
      { jobId: job.id, jobName: job.name },
      'Creating temporary session for cron job execution'
    );

    let sessionId: string | undefined;

    try {
      const { sessionId: sid, session } = createTemporarySession(job.id, {
        chatId: job.chatId,
      });
      sessionId = sid;

      logger.info(
        { jobId: job.id, promptLength: job.prompt.length },
        'Sending prompt to Agent'
      );

      const result = await session.agent.run(job.prompt);

      if (result.success) {
        logger.info(
          {
            jobId: job.id,
            sessionId,
            steps: result.steps,
            toolCalls: result.toolCalls,
            responseLength: result.finalText.length,
          },
          'Cron job Agent execution completed successfully'
        );

        if (result.tokenUsage) {
          logger.info(
            { jobId: job.id, tokenUsage: result.tokenUsage },
            ' Token usage'
          );
        }
      } else {
        logger.error(
          { jobId: job.id, error: result.error },
          'Cron job Agent execution failed'
        );
      }

      removeTemporarySession(sessionId);
      logger.debug({ sessionId }, 'Temporary session cleaned up');
    } catch (error) {
      logger.error(
        { jobId: job.id, sessionId, error },
        'Error executing cron job via Agent'
      );

      if (sessionId) {
        try {
          removeTemporarySession(sessionId);
        } catch (error) {
          logger.error({ error }, 'Error removing session after cron job execution');
        }
      }
    }
  }
}

export const promptExecutor = new PromptExecutor();

export async function initializePromptExecutor(): Promise<void> {
  cronJobScheduler.setExecutor(async (job) => {
    await promptExecutor.execute(job);
  });

  logger.info({}, 'PromptExecutor initialized for cron jobs');
}
