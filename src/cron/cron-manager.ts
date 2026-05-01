/** 定时任务管理器 — 持久化任务、调度计时器并记录执行历史。 */

import type { CronJobRecord, OutboundMessage, SessionKey } from '../core/types';
import type { DatabaseManager } from '../core/database/database-manager';
import { createScopedLogger } from '../core/logger';
import { BaseManager } from '../core/base-manager';
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

type CronManagerStoredDeps = {
  cronJobs: CronJobRepositoryLike;
  cronRuns: CronRunRepositoryLike;
  executor: CronExecutor;
  scheduler: CronScheduler;
}

export class CronManager extends BaseManager<CronManagerStoredDeps> {
  private readonly inFlight = new Set<Promise<unknown>>();

  // @ts-expect-error — override accepts wider input type than stored deps
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async initialize(dependencies: CronManagerDependencies): Promise<void> {
    if (this.deps) {
      this.logger.warn('CronManager 已初始化 — 跳过');
      return;
    }

    const cronJobs = dependencies.databaseManager.cronJobs;
    const cronRuns = dependencies.databaseManager.cronRuns;
    const scheduler = dependencies.scheduler ?? new CronScheduler();
    const executor = new CronExecutor({
      cronRuns,
      pipeline: dependencies.pipeline,
      send: dependencies.send,
    });

    const running = await cronRuns.findRunning();
    await cronRuns.markAbandoned(running.map((run) => run.id));

    super.initialize({ cronJobs, cronRuns, executor, scheduler });
    await this.reloadSchedules();
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async destroy(): Promise<void> {
    const deps = this.getDeps();
    deps.scheduler.clearAll();
    if (this.inFlight.size > 0) {
      logger.info('等待进行中的定时任务完成', { count: this.inFlight.size });
      await Promise.allSettled([...this.inFlight]);
    }
    super.destroy();
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

    const cronJobs = this.getDeps().cronJobs;
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
    return await this.getDeps().cronJobs.findAll();
  }

  async deleteJob(jobId: string): Promise<boolean> {
    this.assertInitialized();
    const cronJobs = this.getDeps().cronJobs;
    const deleted = await cronJobs.delete(jobId);
    if (deleted) {
      this.getDeps().scheduler.cancel(jobId);
      logger.info('定时任务已删除', { jobId });
    }
    return deleted;
  }

  async runJobNow(jobId: string): Promise<string> {
    this.assertInitialized();
    const job = await this.getDeps().cronJobs.findById(jobId);
    if (!job) {
      throw new Error(`未找到定时任务 "${jobId}"`);
    }
    return await this.getDeps().executor.execute(job);
  }

  async reloadSchedules(): Promise<void> {
    this.assertInitialized();
    this.getDeps().scheduler.clearAll();
    const cronJobs = this.getDeps().cronJobs;
    const jobs = await cronJobs.findAll();
    for (const job of jobs) {
      if (job.nextRun) {
        this.schedule(job);
      }
    }
    logger.info('定时任务调度已加载', { count: jobs.length });
  }

  private schedule(job: CronJobRecord): void {
    this.getDeps().scheduler.schedule(job, () => {
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
    const cronJobs = this.getDeps().cronJobs;
    const executor = this.getDeps().executor;
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

}
