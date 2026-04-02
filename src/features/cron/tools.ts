import { cronJobRepository, generateCronId, cronJobScheduler, type CronJobRecord } from '../../platform/db/index.js';
import { logger } from '../../platform/observability/logger.js';

export interface CreateCronJobInput {
  chatId: string;
  name: string;
  cronExpression: string;
  command: string;
  metadata?: Record<string, unknown>;
}

export async function createCronJob(input: CreateCronJobInput): Promise<CronJobRecord> {
  if (!cronJobScheduler.validateCronExpression(input.cronExpression)) {
    throw new Error(`Invalid cron expression: ${input.cronExpression}`);
  }

  const id = generateCronId();
  const nextRunAt = cronJobScheduler.calculateNextRunTime(input.cronExpression) || undefined;

  const job = cronJobRepository.create({
    id,
    chatId: input.chatId,
    name: input.name,
    cronExpression: input.cronExpression,
    command: input.command,
    nextRunAt,
    metadata: input.metadata,
  });

  logger.info({ id: job.id, name: job.name }, 'Cron job created via tool');
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
  }
  return result;
}

export async function toggleCronJob(id: string, enabled: boolean): Promise<CronJobRecord | null> {
  const job = cronJobRepository.update(id, { enabled });
  if (job) {
    logger.info({ id, enabled }, 'Cron job toggled via tool');
  }
  return job;
}

export async function updateCronJob(
  id: string,
  updates: Partial<Pick<CronJobRecord, 'name' | 'cronExpression' | 'command'>>
): Promise<CronJobRecord | null> {
  if (updates.cronExpression && !cronJobScheduler.validateCronExpression(updates.cronExpression)) {
    throw new Error(`Invalid cron expression: ${updates.cronExpression}`);
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
