import { randomUUID } from 'crypto';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import { validateExpression, getNextRunAt } from '@/platform/cron/schedule-engine.js';
import { cronJobRepository } from '@/platform/db/repositories/cron-job-repository.js';
import { cronRunRepository } from '@/platform/db/repositories/cron-run-repository.js';
import type { CronJob } from '@/platform/db/repositories/cron-job-repository.js';
import type { CronRun } from '@/platform/db/repositories/cron-run-repository.js';
import type {
  CreateCronJobInput,
  UpdateCronJobInput,
  CronExecutor,
} from './types.js';

export type { CronJob } from '@/platform/db/repositories/cron-job-repository.js';

export class CronService {
  private running = false;
  private nextTimeoutId: NodeJS.Timeout | null = null;
  private activeJobs = new Set<string>();
  private executor: CronExecutor | null = null;

  setExecutor(executor: CronExecutor): void {
    this.executor = executor;
  }

  createJob(input: CreateCronJobInput): CronJob {
    this.assertValidPrompt(input.prompt);
    this.assertValidCronExpression(input.cronExpression);

    const job = cronJobRepository.create({
      id: randomUUID(),
      name: input.name,
      cronExpression: input.cronExpression,
      prompt: input.prompt,
      nextRunAt: getNextRunAt(input.cronExpression) || undefined,
    });

    this.rescheduleIfRunning();
    return job;
  }

  listJobs(): CronJob[] {
    return cronJobRepository.findAll();
  }

  deleteJob(id: string): boolean {
    const deleted = cronJobRepository.delete(id);
    if (deleted) {
      this.rescheduleIfRunning();
    }
    return deleted;
  }

  toggleJob(id: string, enabled: boolean): CronJob | null {
    const job = cronJobRepository.findById(id);
    if (!job) return null;

    const nextRunAt = enabled ? getNextRunAt(job.cronExpression) : null;
    const updated = cronJobRepository.update(id, {
      enabled,
      nextRunAt: enabled ? nextRunAt || undefined : null,
    });

    this.rescheduleIfRunning();
    return updated;
  }

  updateJob(id: string, updates: UpdateCronJobInput): CronJob | null {
    const existing = cronJobRepository.findById(id);
    if (!existing) return null;

    if (updates.prompt !== undefined) {
      this.assertValidPrompt(updates.prompt);
    }
    if (updates.cronExpression !== undefined) {
      this.assertValidCronExpression(updates.cronExpression);
    }

    const cronExpression = updates.cronExpression ?? existing.cronExpression;
    const nextRunAt = existing.enabled ? getNextRunAt(cronExpression) : existing.nextRunAt;

    const updated = cronJobRepository.update(id, {
      ...updates,
      nextRunAt: nextRunAt || null,
    });

    this.rescheduleIfRunning();
    return updated;
  }

  start(): void {
    if (this.running) {
      logger.warn({}, 'Cron service already running');
      return;
    }

    this.running = true;
    this.recoverOnStart();
    this.rebuildSchedules();
    this.scheduleNext();
    logger.info({}, 'Cron service started');
  }

  stop(): void {
    this.running = false;

    if (this.nextTimeoutId) {
      clearTimeout(this.nextTimeoutId);
      this.nextTimeoutId = null;
    }

    logger.info({}, 'Cron service stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  getScheduledTaskCount(): number {
    return cronJobRepository.findEnabled().filter(job => Boolean(job.nextRunAt)).length;
  }

  validateCronExpression(expression: string): boolean {
    return validateExpression(expression);
  }

  private recoverOnStart(): void {
    const now = new Date().toISOString();
    cronRunRepository.markAllRunningAsAbandoned(now);
  }

  private rebuildSchedules(): void {
    const now = new Date();
    for (const job of cronJobRepository.findEnabled()) {
      const nextRunAt = job.nextRunAt ? new Date(job.nextRunAt) : null;
      if (nextRunAt && nextRunAt.getTime() > now.getTime()) {
        continue;
      }

      const nextScheduledAt = getNextRunAt(job.cronExpression, now);
      cronJobRepository.updateSchedule(job.id, {
        nextRunAt: nextScheduledAt,
      });
    }
  }

  private rescheduleIfRunning(): void {
    if (!this.running) return;
    this.scheduleNext();
  }

  private findNextSchedulableJob(referenceTimeMs: number): CronJob | null {
    for (const job of cronJobRepository.findEnabled()) {
      if (!job.nextRunAt) {
        continue;
      }

      const isDue = new Date(job.nextRunAt).getTime() <= referenceTimeMs;
      if (isDue && this.activeJobs.has(job.id)) {
        continue;
      }

      return job;
    }

    return null;
  }

  private scheduleNext(): void {
    if (!this.running) return;

    if (this.nextTimeoutId) {
      clearTimeout(this.nextTimeoutId);
      this.nextTimeoutId = null;
    }

    const nowMs = Date.now();
    const nextJob = this.findNextSchedulableJob(nowMs);
    if (!nextJob?.nextRunAt) {
      logger.debug({}, 'No scheduled cron jobs');
      return;
    }

    const delay = Math.max(0, new Date(nextJob.nextRunAt).getTime() - nowMs);
    logger.debug({ jobId: nextJob.id, delayMs: delay }, 'Next cron job scheduled');

    this.nextTimeoutId = setTimeout(() => {
      this.nextTimeoutId = null;
      this.runDueJobs();
    }, delay);
  }

  private runDueJobs(): void {
    if (!this.running) return;

    const now = new Date().toISOString();
    const dueJobs = cronJobRepository.findDue(now);

    for (const job of dueJobs) {
      if (this.activeJobs.has(job.id)) {
        logger.debug({ jobId: job.id }, 'Cron job already running, skipping');
        continue;
      }
      this.executeJob(job);
    }
  }

  private executeJob(job: CronJob): void {
    this.activeJobs.add(job.id);

    const startedAt = new Date().toISOString();
    const run = cronRunRepository.createRunning(job.id, startedAt);
    cronJobRepository.updateSchedule(job.id, { lastRunAt: startedAt });

    this.runExecutor(job, run, startedAt)
      .catch(() => {
        // Errors are already logged and recorded inside runExecutor
      })
      .finally(() => {
        this.activeJobs.delete(job.id);
        this.scheduleNext();
      });
  }

  private async runExecutor(job: CronJob, run: CronRun, startedAt: string): Promise<void> {
    if (!this.executor) {
      const error = 'Cron executor is not configured';
      cronRunRepository.finish(run.id, 'failed', new Date().toISOString(), error);
      logger.error({ jobId: job.id }, error);
      this.advanceSchedule(job, startedAt);
      return;
    }

    try {
      logger.info({ jobId: job.id, jobName: job.name }, 'Executing cron job');
      await this.executor.execute(job);
      cronRunRepository.finish(run.id, 'succeeded', new Date().toISOString());
      logger.info({ jobId: job.id }, 'Cron job executed successfully');
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      cronRunRepository.finish(run.id, 'failed', new Date().toISOString(), errorMessage);
      logger.error({ jobId: job.id, error: errorMessage }, 'Cron job execution failed');
    }

    this.advanceSchedule(job, startedAt);
  }

  private advanceSchedule(job: CronJob, startedAt: string): void {
    const nextRunAt = getNextRunAt(job.cronExpression, new Date());
    cronJobRepository.updateSchedule(job.id, {
      lastRunAt: startedAt,
      nextRunAt,
    });

    if (nextRunAt === null) {
      logger.warn({ jobId: job.id }, 'Cron job disabled because no next run time could be calculated');
    }
  }

  private assertValidCronExpression(expression: string): void {
    if (!validateExpression(expression)) {
      throw new Error(`Invalid cron expression: ${expression}`);
    }
  }

  private assertValidPrompt(prompt: string): void {
    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Prompt is required for cron job execution');
    }
  }
}

export const cronService = new CronService();
