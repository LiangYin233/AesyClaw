/** Cron manager — persists jobs, schedules timers, and records execution history. */

import type { CronJobRecord, OutboundMessage, SessionKey } from '../core/types';
import type { DatabaseManager } from '../core/database/database-manager';
import { createScopedLogger } from '../core/logger';
import {
  CronExecutor,
  type CronPipelineLike,
  type CronRunRepositoryLike,
} from './cron-executor';
import { computeNextRun, CronScheduler, type CronScheduleType } from './cron-scheduler';

const logger = createScopedLogger('cron');

export interface CronJobRepositoryLike {
  create(params: {
    scheduleType: string;
    scheduleValue: string;
    prompt: string;
    sessionKey: SessionKey;
    nextRun: Date | null;
  }): Promise<string>;
  findById(id: string): Promise<CronJobRecord | null>;
  findAll(): Promise<CronJobRecord[]>;
  delete(id: string): Promise<boolean>;
  updateNextRun(id: string, nextRun: Date | null): Promise<void>;
}

export interface CronManagerDependencies {
  databaseManager?: DatabaseManager;
  cronJobs?: CronJobRepositoryLike;
  cronRuns?: CronRunRepositoryLike;
  pipeline: CronPipelineLike;
  send: (sessionKey: SessionKey, message: OutboundMessage) => Promise<void>;
  scheduler?: CronScheduler;
}

export interface CreateCronJobParams {
  scheduleType: CronScheduleType;
  scheduleValue: string;
  prompt: string;
  sessionKey: SessionKey;
}

export class CronManager {
  private cronJobs: CronJobRepositoryLike | null = null;
  private cronRuns: CronRunRepositoryLike | null = null;
  private executor: CronExecutor | null = null;
  private scheduler: CronScheduler = new CronScheduler();
  private initialized = false;

  async initialize(dependencies: CronManagerDependencies): Promise<void> {
    if (this.initialized) {
      logger.warn('CronManager already initialized — skipping');
      return;
    }

    this.cronJobs = dependencies.cronJobs ?? dependencies.databaseManager?.cronJobs ?? null;
    this.cronRuns = dependencies.cronRuns ?? dependencies.databaseManager?.cronRuns ?? null;
    this.scheduler = dependencies.scheduler ?? new CronScheduler();

    if (!this.cronJobs || !this.cronRuns) {
      throw new Error('CronManager requires cron job and run repositories');
    }

    this.executor = new CronExecutor({
      cronRuns: this.cronRuns,
      pipeline: dependencies.pipeline,
      send: dependencies.send,
    });

    const running = await this.cronRuns.findRunning();
    await this.cronRuns.markAbandoned(running.map((run) => run.id));

    this.initialized = true;
    await this.reloadSchedules();
    logger.info('CronManager initialized');
  }

  async destroy(): Promise<void> {
    this.scheduler.clearAll();
    this.initialized = false;
    logger.info('CronManager destroyed');
  }

  async createJob(params: CreateCronJobParams): Promise<string> {
    this.assertInitialized();
    const nextRun = computeNextRun(params.scheduleType, params.scheduleValue);
    if (!nextRun) {
      throw new Error(
        `Invalid or expired cron schedule: ${params.scheduleType} ${params.scheduleValue}`,
      );
    }

    const cronJobs = this.getCronJobs();
    const id = await cronJobs.create({
      scheduleType: params.scheduleType,
      scheduleValue: params.scheduleValue,
      prompt: params.prompt,
      sessionKey: params.sessionKey,
      nextRun,
    });

    const job = await cronJobs.findById(id);
    if (job) {
      this.schedule(job);
    }
    logger.info('Cron job created', { jobId: id, scheduleType: params.scheduleType });
    return id;
  }

  async listJobs(): Promise<CronJobRecord[]> {
    this.assertInitialized();
    return this.getCronJobs().findAll();
  }

  async deleteJob(jobId: string): Promise<boolean> {
    this.assertInitialized();
    const deleted = await this.getCronJobs().delete(jobId);
    if (deleted) {
      this.scheduler.cancel(jobId);
      logger.info('Cron job deleted', { jobId });
    }
    return deleted;
  }

  async runJobNow(jobId: string): Promise<string> {
    this.assertInitialized();
    const job = await this.getCronJobs().findById(jobId);
    if (!job) {
      throw new Error(`Cron job "${jobId}" not found`);
    }
    return this.getExecutor().execute(job);
  }

  async reloadSchedules(): Promise<void> {
    this.assertInitialized();
    this.scheduler.clearAll();
    const jobs = await this.getCronJobs().findAll();
    for (const job of jobs) {
      if (job.nextRun) {
        this.schedule(job);
      }
    }
    logger.info('Cron schedules loaded', { count: jobs.length });
  }

  private schedule(job: CronJobRecord): void {
    this.scheduler.schedule(job, () => {
      void this.executeScheduledJob(job.id).catch((err) => {
        logger.error(`Scheduled cron job "${job.id}" failed`, err);
      });
    });
  }

  private async executeScheduledJob(jobId: string): Promise<string> {
    const cronJobs = this.getCronJobs();
    const executor = this.getExecutor();
    const job = await cronJobs.findById(jobId);
    if (!job) {
      throw new Error(`Cron job "${jobId}" not found`);
    }

    try {
      return await executor.execute(job);
    } finally {
      const nextRun = computeNextRun(job.scheduleType, job.scheduleValue);
      await cronJobs.updateNextRun(job.id, nextRun);

      const updated = await cronJobs.findById(job.id);
      if (updated && updated.nextRun) {
        this.schedule(updated);
      }
    }
  }

  private assertInitialized(): void {
    if (!this.initialized || !this.cronJobs || !this.cronRuns || !this.executor) {
      throw new Error('CronManager not initialized');
    }
  }

  private getCronJobs(): CronJobRepositoryLike {
    this.assertInitialized();
    if (!this.cronJobs) {
      throw new Error('CronManager not initialized');
    }
    return this.cronJobs;
  }

  private getExecutor(): CronExecutor {
    this.assertInitialized();
    if (!this.executor) {
      throw new Error('CronManager not initialized');
    }
    return this.executor;
  }
}
