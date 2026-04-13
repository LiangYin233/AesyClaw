import { createTemporarySession, removeTemporarySession } from '@/agent/session/session-runtime.js';
import { cronJobScheduler, generateCronId } from '@/platform/db/cron-scheduler.js';
import { cronJobRepository, type CronJobRecord } from '@/platform/db/repositories/cron-job-repository.js';
import { sessionRepository } from '@/platform/db/repositories/session-repository.js';
import { eventBus, SystemEvents } from '@/platform/events/event-bus.js';
import { logger } from '@/platform/observability/logger.js';

export interface CreateCronJobInput {
  chatId: string;
  name: string;
  cronExpression: string;
  command: string;
  prompt: string;
  metadata?: Record<string, unknown>;
}

export async function createCronJob(input: CreateCronJobInput): Promise<CronJobRecord> {
  if (!cronJobScheduler.validateCronExpression(input.cronExpression)) {
    throw new Error(`Invalid cron expression: ${input.cronExpression}`);
  }

  if (!input.prompt || input.prompt.trim().length === 0) {
    throw new Error('Prompt is required for cron job execution');
  }

  const id = generateCronId();
  const nextRunAt = cronJobScheduler.calculateNextRunTime(input.cronExpression) || undefined;

  if (!sessionRepository.findByChatId(input.chatId)) {
    sessionRepository.create({
      chatId: input.chatId,
      channelType: 'unknown',
      channelId: 'unknown',
      metadata: {
        source: 'cron',
      },
    });
  }

  const job = cronJobRepository.create({
    id,
    chatId: input.chatId,
    name: input.name,
    cronExpression: input.cronExpression,
    command: input.command,
    prompt: input.prompt,
    nextRunAt,
    metadata: input.metadata,
  });

  logger.info({ id: job.id, name: job.name }, 'Cron job created with prompt');

  eventBus.emit(SystemEvents.CRON_JOB_CREATED, { job });

  return job;
}

export async function listCronJobs(chatId?: string): Promise<CronJobRecord[]> {
  if (chatId) {
    return cronJobRepository.findByChatId(chatId);
  }
  return cronJobRepository.findEnabled();
}

export async function deleteCronJob(id: string): Promise<boolean> {
  const result = cronJobRepository.delete(id);
  if (result) {
    logger.info({ id }, 'Cron job deleted via tool');
    eventBus.emit(SystemEvents.CRON_JOB_DELETED, { jobId: id });
  }
  return result;
}

export async function toggleCronJob(id: string, enabled: boolean): Promise<CronJobRecord | null> {
  const job = cronJobRepository.update(id, { enabled });
  if (job) {
    logger.info({ id, enabled }, 'Cron job toggled via tool');
    eventBus.emit(SystemEvents.CRON_JOB_TOGGLED, { job, enabled });
  }
  return job;
}

export async function updateCronJob(
  id: string,
  updates: Partial<Pick<CronJobRecord, 'name' | 'cronExpression' | 'command' | 'prompt'>>
): Promise<CronJobRecord | null> {
  if (updates.cronExpression && !cronJobScheduler.validateCronExpression(updates.cronExpression)) {
    throw new Error(`Invalid cron expression: ${updates.cronExpression}`);
  }

  if (updates.prompt !== undefined && updates.prompt.trim().length === 0) {
    throw new Error('Prompt cannot be empty');
  }

  const updateData: Partial<CronJobRecord> = { ...updates };
  if (updates.cronExpression) {
    const nextRunAt = cronJobScheduler.calculateNextRunTime(updates.cronExpression);
    if (nextRunAt) {
      updateData.nextRunAt = nextRunAt;
    }
  }

  const job = cronJobRepository.update(id, updateData);
  if (job) {
    logger.info({ id }, 'Cron job updated via tool');
    eventBus.emit(SystemEvents.CRON_JOB_UPDATED, { job });
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
        prompt: job.prompt,
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
