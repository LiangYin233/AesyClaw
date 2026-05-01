/** 定时任务管理器 — 持久化任务、调度计时器并记录执行历史。 */

import type { CronJobRecord, OutboundMessage, SessionKey } from '../core/types';
import type { DatabaseManager } from '../core/database/database-manager';
import { createScopedLogger } from '../core/logger';
import { CronExecutor, type CronPipelineLike, type CronRunRepositoryLike } from './cron-executor';
import { computeNextRun, CronScheduler, type CronScheduleType } from './cron-scheduler';

const logger = createScopedLogger('cron');

export type CronJobRepositoryLike = {
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

export type CronManagerDependencies = {
  databaseManager: DatabaseManager;
  pipeline: CronPipelineLike;
  send: (sessionKey: SessionKey, message: OutboundMessage) => Promise<void>;
  scheduler?: CronScheduler;
}

export type CreateCronJobParams = {
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
  private readonly inFlight = new Set<Promise<unknown>>();

  async initialize(dependencies: CronManagerDependencies): Promise<void> {
    if (this.initialized) {
      logger.warn('CronManager 已初始化 — 跳过');
      return;
    }

    this.cronJobs = dependencies.databaseManager.cronJobs;
    this.cronRuns = dependencies.databaseManager.cronRuns;
    this.scheduler = dependencies.scheduler ?? new CronScheduler();

    this.executor = new CronExecutor({
      cronRuns: this.cronRuns,
      pipeline: dependencies.pipeline,
      send: dependencies.send,
    });

    const running = await this.cronRuns.findRunning();
    await this.cronRuns.markAbandoned(running.map((run) => run.id));

    this.initialized = true;
    await this.reloadSchedules();
    logger.info('CronManager 已初始化');
  }

  async destroy(): Promise<void> {
    this.scheduler.clearAll();
    if (this.inFlight.size > 0) {
      logger.info('等待进行中的定时任务完成', { count: this.inFlight.size });
      await Promise.allSettled([...this.inFlight]);
    }
    this.initialized = false;
    logger.info('CronManager 已销毁');
  }

  async createJob(params: CreateCronJobParams): Promise<string> {
    this.assertInitialized();
    const nextRun = computeNextRun(params.scheduleType, params.scheduleValue);
    if (!nextRun) {
      throw new Error(
        `无效或过期的定时任务调度：${params.scheduleType} ${params.scheduleValue}`,
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
    logger.info('定时任务已创建', { jobId: id, scheduleType: params.scheduleType });
    return id;
  }

  async listJobs(): Promise<CronJobRecord[]> {
    this.assertInitialized();
    return await this.getCronJobs().findAll();
  }

  async deleteJob(jobId: string): Promise<boolean> {
    this.assertInitialized();
    const deleted = await this.getCronJobs().delete(jobId);
    if (deleted) {
      this.scheduler.cancel(jobId);
      logger.info('定时任务已删除', { jobId });
    }
    return deleted;
  }

  async runJobNow(jobId: string): Promise<string> {
    this.assertInitialized();
    const job = await this.getCronJobs().findById(jobId);
    if (!job) {
      throw new Error(`未找到定时任务 "${jobId}"`);
    }
    return await this.getExecutor().execute(job);
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
    logger.info('定时任务调度已加载', { count: jobs.length });
  }

  private schedule(job: CronJobRecord): void {
    this.scheduler.schedule(job, () => {
      const run = this.executeScheduledJob(job.id).catch((err) => {
        logger.error(`定时任务 "${job.id}" 调度失败`, err);
      });
      this.trackInFlight(run);
    });
  }

  private trackInFlight(promise: Promise<unknown>): void {
    this.inFlight.add(promise);
    void promise.finally(() => {
      this.inFlight.delete(promise);
    });
  }

  private async executeScheduledJob(jobId: string): Promise<string> {
    const cronJobs = this.getCronJobs();
    const executor = this.getExecutor();
    const job = await cronJobs.findById(jobId);
    if (!job) {
      throw new Error(`未找到定时任务 "${jobId}"`);
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
      throw new Error('CronManager 未初始化');
    }
  }

  private getCronJobs(): CronJobRepositoryLike {
    this.assertInitialized();
    if (!this.cronJobs) {
      throw new Error('CronManager 未初始化');
    }
    return this.cronJobs;
  }

  private getExecutor(): CronExecutor {
    this.assertInitialized();
    if (!this.executor) {
      throw new Error('CronManager 未初始化');
    }
    return this.executor;
  }
}
