import { randomUUID } from 'crypto';
import cron from 'node-cron';
import { logger } from '@/platform/observability/logger.js';
import type { CronJobRecord } from './repositories/cron-job-repository.js';
import { cronJobRepository } from './repositories/cron-job-repository.js';
import { CRON_RUN_STATUS, cronRunRepository } from './repositories/cron-run-repository.js';

interface CreateCronJobInput {
  chatId: string;
  name: string;
  cronExpression: string;
  prompt: string;
}

interface UpdateCronJobInput {
  name?: string;
  cronExpression?: string;
  prompt?: string;
}

interface CronJobExecutor {
  (job: CronJobRecord): Promise<void>;
}

class CronService {
  private running = false;
  private executor: CronJobExecutor | null = null;
  private nextTimeoutId: NodeJS.Timeout | null = null;
  private activeRun: Promise<void> | null = null;

  setExecutor(executor: CronJobExecutor): void {
    this.executor = executor;
  }

  createJob(input: CreateCronJobInput): CronJobRecord {
    this.assertValidPrompt(input.prompt);
    this.assertValidCronExpression(input.cronExpression);

    const job = cronJobRepository.create({
      id: randomUUID(),
      chatId: input.chatId,
      name: input.name,
      cronExpression: input.cronExpression,
      prompt: input.prompt,
      nextRunAt: this.calculateNextRunTime(input.cronExpression) || undefined,
    });

    this.rescheduleIfRunning();
    return job;
  }

  listJobs(chatId?: string): CronJobRecord[] {
    return chatId ? cronJobRepository.findByChatId(chatId) : cronJobRepository.findEnabled();
  }

  deleteJob(id: string): boolean {
    const deleted = cronJobRepository.delete(id);
    if (deleted) {
      this.rescheduleIfRunning();
    }
    return deleted;
  }

  toggleJob(id: string, enabled: boolean): CronJobRecord | null {
    const job = cronJobRepository.findById(id);
    if (!job) {
      return null;
    }

    const nextRunAt = enabled ? this.calculateNextRunTime(job.cronExpression) : null;
    const updated = cronJobRepository.update(id, {
      enabled,
      nextRunAt: enabled ? nextRunAt || undefined : null,
    });

    this.rescheduleIfRunning();
    return updated;
  }

  updateJob(id: string, updates: UpdateCronJobInput): CronJobRecord | null {
    const existing = cronJobRepository.findById(id);
    if (!existing) {
      return null;
    }

    if (updates.prompt !== undefined) {
      this.assertValidPrompt(updates.prompt);
    }
    if (updates.cronExpression !== undefined) {
      this.assertValidCronExpression(updates.cronExpression);
    }

    const cronExpression = updates.cronExpression ?? existing.cronExpression;
    const nextRunAt = existing.enabled ? this.calculateNextRunTime(cronExpression) : existing.nextRunAt;
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
    this.normalizeSchedulesOnStart();
    this.scheduleNext();
    logger.info({}, 'Cron service started');
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.nextTimeoutId) {
      clearTimeout(this.nextTimeoutId);
      this.nextTimeoutId = null;
    }

    if (this.activeRun) {
      await this.activeRun;
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
    return cron.validate(expression);
  }

  calculateNextRunTime(cronExpression: string, from: Date = new Date()): string | null {
    try {
      if (!cron.validate(cronExpression)) {
        return null;
      }

      const parts = cronExpression.split(' ');
      if (parts.length !== 5) return null;

      const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
      const next = new Date(from);
      next.setSeconds(0);
      next.setMilliseconds(0);
      next.setMinutes(next.getMinutes() + 1);

      for (let i = 0; i < 366 * 24 * 60; i++) {
        if (
          this.matches(next.getMinutes(), minute) &&
          this.matches(next.getHours(), hour) &&
          this.matches(next.getDate(), dayOfMonth) &&
          this.matches(next.getMonth() + 1, month) &&
          this.matches(next.getDay(), dayOfWeek)
        ) {
          return next.toISOString();
        }
        next.setMinutes(next.getMinutes() + 1);
      }

      return null;
    } catch {
      return null;
    }
  }

  private normalizeSchedulesOnStart(): void {
    const now = new Date();

    for (const job of cronJobRepository.findEnabled()) {
      const nextRunAt = job.nextRunAt ? new Date(job.nextRunAt) : null;
      if (nextRunAt && nextRunAt.getTime() > now.getTime()) {
        continue;
      }

      const nextScheduledAt = this.calculateNextRunTime(job.cronExpression, now);
      cronJobRepository.updateSchedule(job.id, {
        enabled: nextScheduledAt !== null,
        nextRunAt: nextScheduledAt,
      });
    }
  }

  private reschedulePending = false;

  private rescheduleIfRunning(): void {
    if (!this.running) return;

    if (this.activeRun) {
      this.reschedulePending = true;
      return;
    }

    this.scheduleNext();
  }

  private scheduleNext(): void {
    this.reschedulePending = false;

    if (!this.running || this.activeRun) {
      return;
    }

    if (this.nextTimeoutId) {
      clearTimeout(this.nextTimeoutId);
      this.nextTimeoutId = null;
    }

    const nextJob = cronJobRepository.findNextScheduled();
    if (!nextJob?.nextRunAt) {
      logger.debug({}, 'No scheduled cron jobs');
      return;
    }

    const delay = Math.max(0, new Date(nextJob.nextRunAt).getTime() - Date.now());
    logger.debug({ jobId: nextJob.id, delayMs: delay }, 'Next cron job scheduled');

    this.nextTimeoutId = setTimeout(() => {
      this.nextTimeoutId = null;
      this.runNextDueJob();
    }, delay);
  }

  private runNextDueJob(): void {
    if (!this.running || this.activeRun) {
      return;
    }

    const nextJob = cronJobRepository.findNextScheduled();
    if (!nextJob?.nextRunAt) {
      this.scheduleNext();
      return;
    }

    if (new Date(nextJob.nextRunAt).getTime() > Date.now()) {
      this.scheduleNext();
      return;
    }

    this.activeRun = this.executeJob(nextJob).finally(() => {
      this.activeRun = null;
      if (this.running || this.reschedulePending) {
        this.scheduleNext();
      }
    });
  }

  private async executeJob(job: CronJobRecord): Promise<void> {
    const startedAt = new Date().toISOString();
    const run = cronRunRepository.createRunning(job.id, startedAt);
    cronJobRepository.markRunStarted(job.id, startedAt);

    if (!this.executor) {
      cronRunRepository.finish(run.id, CRON_RUN_STATUS.Failed, new Date().toISOString(), 'Cron executor is not configured');
      logger.error({ jobId: job.id }, 'Cron executor is not configured');
      this.advanceSchedule(job, startedAt);
      return;
    }

    try {
      logger.info({ jobId: job.id, jobName: job.name }, 'Executing cron job');
      await this.executor(job);
      cronRunRepository.finish(run.id, CRON_RUN_STATUS.Succeeded, new Date().toISOString());
      logger.info({ jobId: job.id }, 'Cron job executed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      cronRunRepository.finish(run.id, CRON_RUN_STATUS.Failed, new Date().toISOString(), errorMessage);
      logger.error({ jobId: job.id, error }, 'Cron job execution failed');
    }

    this.advanceSchedule(job, startedAt);
  }

  private advanceSchedule(job: CronJobRecord, startedAt: string): void {
    const nextRunAt = this.calculateNextRunTime(job.cronExpression, new Date());
    cronJobRepository.updateSchedule(job.id, {
      enabled: nextRunAt !== null && job.enabled,
      lastRunAt: startedAt,
      nextRunAt,
    });

    if (nextRunAt === null) {
      logger.warn({ jobId: job.id }, 'Cron job disabled because no next run time could be calculated');
    }
  }

  private matches(value: number, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.includes(',')) {
      return pattern.split(',').some(part => this.matches(value, part.trim()));
    }
    if (pattern.includes('/')) {
      const [range, stepStr] = pattern.split('/');
      const step = parseInt(stepStr, 10);
      if (range === '*') {
        return value % step === 0;
      }
      if (range.includes('-')) {
        const [start, end] = range.split('-').map(Number);
        return value >= start && value <= end && (value - start) % step === 0;
      }
      const start = parseInt(range, 10);
      return value >= start && (value - start) % step === 0;
    }
    if (pattern.includes('-')) {
      const [start, end] = pattern.split('-').map(Number);
      return value >= start && value <= end;
    }
    return parseInt(pattern, 10) === value;
  }

  private assertValidCronExpression(expression: string): void {
    if (!this.validateCronExpression(expression)) {
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
