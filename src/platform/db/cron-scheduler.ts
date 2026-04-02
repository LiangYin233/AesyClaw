import cron from 'node-cron';
import { cronJobRepository, type CronJobRecord } from './repositories/cron-job-repository.js';
import { logger } from '../observability/logger.js';

export interface CronJobExecutor {
  (job: CronJobRecord): Promise<void>;
}

export class CronJobScheduler {
  private static instance: CronJobScheduler;
  private running: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private executor: CronJobExecutor | null = null;
  private checkInterval: number = 60000;

  private constructor() {}

  static getInstance(): CronJobScheduler {
    if (!CronJobScheduler.instance) {
      CronJobScheduler.instance = new CronJobScheduler();
    }
    return CronJobScheduler.instance;
  }

  setExecutor(executor: CronJobExecutor): void {
    this.executor = executor;
  }

  start(): void {
    if (this.running) {
      logger.warn({}, 'CronJobScheduler already running');
      return;
    }

    this.running = true;
    this.intervalId = setInterval(() => this.checkAndExecuteJobs(), this.checkInterval);
    logger.info({ checkInterval: this.checkInterval }, 'CronJobScheduler started');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    logger.info({}, 'CronJobScheduler stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private async checkAndExecuteJobs(): Promise<void> {
    if (!this.executor) {
      logger.warn({}, 'No executor set for CronJobScheduler');
      return;
    }

    try {
      const dueJobs = cronJobRepository.findDueJobs();

      for (const job of dueJobs) {
        await this.executeJob(job);
      }
    } catch (error) {
      logger.error({ error }, 'Error checking cron jobs');
    }
  }

  private async executeJob(job: CronJobRecord): Promise<void> {
    if (!this.executor) return;

    try {
      logger.info({ id: job.id, name: job.name }, 'Executing cron job');

      await this.executor(job);

      cronJobRepository.incrementRunCount(job.id);

      const nextRunAt = this.calculateNextRunTime(job.cronExpression);
      if (nextRunAt) {
        cronJobRepository.setNextRunTime(job.id, nextRunAt);
      }

      logger.info({ id: job.id }, 'Cron job executed successfully');
    } catch (error) {
      logger.error({ id: job.id, error }, 'Error executing cron job');
    }
  }

  calculateNextRunTime(cronExpression: string): string | null {
    try {
      if (!cron.validate(cronExpression)) {
        return null;
      }

      const now = new Date();
      const parts = cronExpression.split(' ');
      if (parts.length !== 5) return null;

      const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
      const next = new Date(now);
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

  private matches(value: number, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.includes('/')) {
      const [, step] = pattern.split('/');
      return value % parseInt(step, 10) === 0;
    }
    if (pattern.includes(',')) {
      return pattern.split(',').some(p => parseInt(p, 10) === value);
    }
    if (pattern.includes('-')) {
      const [start, end] = pattern.split('-').map(Number);
      return value >= start && value <= end;
    }
    return parseInt(pattern, 10) === value;
  }

  validateCronExpression(expression: string): boolean {
    return cron.validate(expression);
  }
}

export const cronJobScheduler = CronJobScheduler.getInstance();

export function generateCronId(): string {
  return `cron_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
