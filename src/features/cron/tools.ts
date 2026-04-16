import { createTemporarySession } from '@/agent/session/session-runtime.js';
import { cronService } from '@/platform/db/cron-service.js';
import type { CronJobRecord } from '@/platform/db/repositories/cron-job-repository.js';
import { logger } from '@/platform/observability/logger.js';

class PromptExecutor {
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

    } catch (error) {
      logger.error(
        { jobId: job.id, sessionId, error },
        'Error executing cron job via Agent'
      );
    }
  }
}

const promptExecutor = new PromptExecutor();

export async function initializePromptExecutor(): Promise<void> {
  cronService.setExecutor(async (job) => {
    await promptExecutor.execute(job);
  });

  logger.info({}, 'PromptExecutor initialized for cron jobs');
}
