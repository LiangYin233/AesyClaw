import { randomUUID } from 'crypto';
import { cronJobRepository, type CronJobRecord } from '../../platform/db/repositories/cron-job-repository.js';
import { cronJobScheduler, generateCronId } from '../../platform/db/cron-scheduler.js';
import { logger } from '../../platform/observability/logger.js';
import { eventBus, SystemEvents } from '../../platform/events/index.js';
import { configManager } from '../config/config-manager.js';
import { AgentManager } from '../../agent/core/engine.js';
import { ToolRegistry } from '../../platform/tools/registry.js';

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

export function parseCronDescription(cronExpression: string): string {
  const parts = cronExpression.split(' ');
  if (parts.length < 5) return 'Invalid cron expression';

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const descriptions: string[] = [];

  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every minute';
  }

  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every hour';
  }

  if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every day at midnight';
  }

  if (dayOfWeek !== '*' && dayOfWeek !== '?') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayIndex = parseInt(dayOfWeek);
    if (!isNaN(dayIndex) && dayIndex >= 0 && dayIndex <= 6) {
      descriptions.push(`Every ${days[dayIndex]}`);
    }
  }

  if (hour !== '*' && minute !== '*') {
    descriptions.push(`at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`);
  }

  return descriptions.join(' ') || `Custom schedule: ${cronExpression}`;
}

export function getSchedulerStatus(): {
  running: boolean;
  scheduledTasks: number;
  nextTask: { jobId: string; executeAt: string; delayMs: number } | null;
} {
  return {
    running: cronJobScheduler.isRunning(),
    scheduledTasks: cronJobScheduler.getScheduledTaskCount(),
    nextTask: cronJobScheduler.getNextScheduledTask(),
  };
}

export class PromptExecutor {
  private agentManager: AgentManager;
  private toolRegistry: ToolRegistry;
  private config: any;

  constructor() {
    this.agentManager = AgentManager.getInstance();
    this.toolRegistry = ToolRegistry.getInstance();
  }

  async execute(job: CronJobRecord): Promise<void> {
    if (!job.prompt) {
      logger.warn({ jobId: job.id }, 'Cron job has no prompt, skipping execution');
      return;
    }

    const tempChatId = `cron_${job.id}_${Date.now()}`;

    logger.info(
      { jobId: job.id, jobName: job.name, tempChatId },
      '🤖 Creating temporary session for cron job execution'
    );

    try {
      this.config = configManager.getConfig();

      const systemPrompt = this.config?.agent?.systemPrompt || '你是一个有帮助的AI助手。';
      const model = this.config?.providers?.openai?.model || 'gpt-4o-mini';
      const maxSteps = this.config?.agent?.maxSteps || 15;

      const agent = this.agentManager.getOrCreate(tempChatId, {
        llm: {
          provider: 'openai-chat' as any,
          model,
        },
        systemPrompt,
        maxSteps,
      });

      logger.info(
        { jobId: job.id, promptLength: job.prompt.length },
        '📤 Sending prompt to Agent'
      );

      const result = await agent.run(job.prompt);

      if (result.success) {
        logger.info(
          {
            jobId: job.id,
            tempChatId,
            steps: result.steps,
            toolCalls: result.toolCalls,
            responseLength: result.finalText.length,
          },
          '✅ Cron job Agent execution completed successfully'
        );

        if (result.tokenUsage) {
          logger.info(
            { jobId: job.id, tokenUsage: result.tokenUsage },
            '📊 Token usage'
          );
        }
      } else {
        logger.error(
          { jobId: job.id, error: result.error },
          '❌ Cron job Agent execution failed'
        );
      }

      this.agentManager.removeAgent(tempChatId);
      logger.debug({ tempChatId }, '🧹 Temporary session cleaned up');
    } catch (error) {
      logger.error(
        { jobId: job.id, tempChatId, error },
        '❌ Error executing cron job via Agent'
      );

      try {
        this.agentManager.removeAgent(tempChatId);
      } catch {
      }
    }
  }
}

export const promptExecutor = new PromptExecutor();

export async function initializePromptExecutor(): Promise<void> {
  cronJobScheduler.setExecutor(async (job) => {
    await promptExecutor.execute(job);
  });

  logger.info({}, '✅ PromptExecutor initialized for cron jobs');
}
