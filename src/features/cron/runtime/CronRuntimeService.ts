import { CronExpressionParser } from 'cron-parser';
import { logger } from '../../../platform/observability/index.js';
import { formatLocalTimestamp } from '../../../platform/observability/logging.js';
import type { CronJob } from '../domain/cronTypes.js';
import { CronStore } from '../infrastructure/CronStore.js';
import { normalizeCronError } from '../shared/errors.js';

const FAILED_JOB_RETRY_DELAY_MS = 60_000;
const MAX_CATCH_UP_DELAY_MS = 60_000;

export class CronRuntimeService {
  private jobs: Map<string, CronJob> = new Map();
  private timer?: NodeJS.Timeout;
  private store: CronStore;
  private onJobExecute?: (job: CronJob) => Promise<void>;
  private log = logger.child('Cron');
  private readyPromise?: Promise<void>;
  private ready = false;
  private started = false;

  constructor(
    dbPath: string,
    onJobExecute?: (job: CronJob) => Promise<void>
  ) {
    const actualDbPath = dbPath.replace(/\.json$/, '.db');
    this.store = new CronStore(actualDbPath);
    this.onJobExecute = onJobExecute;
  }

  async addJob(job: CronJob): Promise<CronJob> {
    await this.ensureReady();
    this.computeNextRun(job);
    await this.store.upsert(job);
    this.jobs.set(job.id, job);
    this.log.info('定时任务已创建', {
      jobId: job.id,
      jobName: job.name,
      kind: job.schedule.kind,
      nextRunAt: job.nextRunAtMs ? formatLocalTimestamp(new Date(job.nextRunAtMs)) : undefined,
      target: job.payload.target
    });
    if (this.started) {
      this.wakeUp();
    }
    return job;
  }

  async saveJob(job: CronJob): Promise<CronJob> {
    await this.ensureReady();
    this.computeNextRun(job);
    await this.store.upsert(job);
    this.jobs.set(job.id, job);
    this.log.info('定时任务已更新', {
      jobId: job.id,
      jobName: job.name,
      kind: job.schedule.kind,
      nextRunAt: job.nextRunAtMs ? formatLocalTimestamp(new Date(job.nextRunAtMs)) : undefined,
      target: job.payload.target
    });
    if (this.started) {
      this.wakeUp();
    }
    return job;
  }

  async removeJob(id: string): Promise<boolean> {
    await this.ensureReady();
    if (!this.jobs.has(id)) {
      return false;
    }

    const removed = await this.store.delete(id);
    if (!removed) {
      return false;
    }

    this.jobs.delete(id);
    if (this.started) {
      this.wakeUp();
    }
    this.log.info('定时任务已删除', { jobId: id });
    return true;
  }

  async enableJob(id: string, enabled: boolean): Promise<void> {
    await this.ensureReady();
    const job = this.jobs.get(id);
    if (!job) {
      return;
    }

    const nextRunAtMs = this.computeNextRunForState(job, enabled);
    await this.store.updateStatus(id, enabled, nextRunAtMs);

    job.enabled = enabled;
    job.nextRunAtMs = nextRunAtMs;
    this.log.info('定时任务状态已更新', {
      jobId: id,
      enabled,
      nextRunAt: job.nextRunAtMs ? formatLocalTimestamp(new Date(job.nextRunAtMs)) : undefined
    });
    if (this.started) {
      this.wakeUp();
    }
  }

  async getJob(id: string): Promise<CronJob | undefined> {
    await this.ensureReady();
    return this.jobs.get(id);
  }

  async listJobs(): Promise<CronJob[]> {
    await this.ensureReady();
    return Array.from(this.jobs.values()).map((job) => ({
      ...job,
      payload: { ...job.payload, detail: '[隐藏]' }
    }));
  }

  async start(): Promise<void> {
    await this.ensureReady();
    if (this.started) {
      return;
    }

    this.started = true;
    this.scheduleNext();
    this.log.info('定时任务服务已启动', { jobCount: this.jobs.size });
  }

  stop(): void {
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.store.close().catch((err) => this.log.error('关闭任务存储失败:', err));
    this.log.info('定时任务服务已停止');
  }

  private wakeUp(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.scheduleNext();
  }

  private async ensureReady(): Promise<void> {
    if (this.ready) {
      return;
    }

    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        await this.store.initialize();
        await this.load();
        this.ready = true;
      })();
    }

    await this.readyPromise;
  }

  private computeNextRunForState(job: CronJob, enabled: boolean): number | undefined {
    if (!enabled) {
      return undefined;
    }

    const nextJob: CronJob = {
      ...job,
      enabled,
      schedule: { ...job.schedule },
      payload: { ...job.payload }
    };
    this.computeNextRun(nextJob);
    return nextJob.nextRunAtMs;
  }

  private scheduleNext(): void {
    const now = Date.now();
    let nearest = Infinity;

    for (const job of this.jobs.values()) {
      if (job.enabled && job.nextRunAtMs && job.nextRunAtMs < nearest) {
        nearest = job.nextRunAtMs;
      }
    }

    if (nearest === Infinity) {
      return;
    }

    const delay = Math.max(0, nearest - now);

    this.timer = setTimeout(async () => {
      try {
        await this.runDueJobs();
      } catch (error) {
        this.log.error('执行到期任务时出错', {
          error: normalizeCronError(error)
        });
      } finally {
        this.scheduleNext();
      }
    }, delay);
  }

  private async runDueJobs(): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];
    const toUpdate: CronJob[] = [];
    const statusUpdates: Array<{ id: string; enabled: boolean; nextRunAtMs?: number }> = [];

    for (const job of this.jobs.values()) {
      if (job.enabled && job.nextRunAtMs && now >= job.nextRunAtMs) {
        const overdueMs = now - job.nextRunAtMs;

        if (overdueMs > MAX_CATCH_UP_DELAY_MS) {
          this.log.info('定时任务已超过补跑窗口，跳过本次执行', {
            jobId: job.id,
            jobName: job.name,
            overdueMs,
            scheduledAt: formatLocalTimestamp(new Date(job.nextRunAtMs))
          });

          if (job.schedule.kind === 'once') {
            job.enabled = false;
            job.nextRunAtMs = undefined;
            statusUpdates.push({ id: job.id, enabled: false, nextRunAtMs: undefined });
            this.log.info('一次性定时任务因错过补跑窗口已停用', {
              jobId: job.id
            });
            continue;
          }

          this.computeNextRun(job);
          toUpdate.push(job);
          this.log.info('循环定时任务已跳过过期执行并重新排期', {
            jobId: job.id,
            nextRunAt: job.nextRunAtMs ? formatLocalTimestamp(new Date(job.nextRunAtMs)) : undefined
          });
          continue;
        }

        this.log.info('定时任务执行中', {
          jobId: job.id,
          jobName: job.name,
          kind: job.schedule.kind,
          target: job.payload.target
        });

        let executedSuccessfully = true;

        if (this.onJobExecute) {
          try {
            await this.onJobExecute(job);
            this.log.info('定时任务执行完成', { jobId: job.id, jobName: job.name });
          } catch (error: unknown) {
            executedSuccessfully = false;
            this.log.error('定时任务执行失败', {
              jobId: job.id,
              jobName: job.name,
              error: normalizeCronError(error)
            });
          }
        }

        if (!executedSuccessfully) {
          if (job.schedule.kind === 'once') {
            job.enabled = false;
            job.nextRunAtMs = undefined;
            statusUpdates.push({ id: job.id, enabled: false, nextRunAtMs: undefined });
            this.log.info('一次性定时任务执行失败，已保留并停用', {
              jobId: job.id
            });
            continue;
          }

          job.nextRunAtMs = now + FAILED_JOB_RETRY_DELAY_MS;
          toUpdate.push(job);
          this.log.info('定时任务将在失败后重试', {
            jobId: job.id,
            retryAt: formatLocalTimestamp(new Date(job.nextRunAtMs))
          });
          continue;
        }

        job.lastRunAtMs = now;

        if (job.schedule.kind === 'once') {
          toRemove.push(job.id);
        } else {
          this.computeNextRun(job);
          toUpdate.push(job);
        }
      }
    }

    for (const id of toRemove) {
      this.jobs.delete(id);
      await this.store.delete(id);
      this.log.info('一次性定时任务已移除', { jobId: id });
    }

    if (toUpdate.length > 0) {
      await this.store.batchUpdate(toUpdate);
    }

    for (const update of statusUpdates) {
      await this.store.updateStatus(update.id, update.enabled, update.nextRunAtMs);
    }
  }

  computeNextRun(job: CronJob): void {
    const now = Date.now();

    switch (job.schedule.kind) {
      case 'once':
        if (job.schedule.onceAt) {
          const atMs = new Date(job.schedule.onceAt).getTime();
          if (Number.isNaN(atMs)) {
            this.log.warn(`无效的 onceAt 时间: ${job.schedule.onceAt}`);
            job.nextRunAtMs = undefined;
            break;
          }
          job.nextRunAtMs = atMs > now ? atMs : undefined;
        } else {
          job.nextRunAtMs = undefined;
        }
        break;

      case 'interval':
        job.nextRunAtMs = (job.schedule.intervalMs && job.schedule.intervalMs > 0)
          ? now + job.schedule.intervalMs
          : undefined;
        break;

      case 'daily':
        if (job.schedule.dailyAt) {
          const parts = job.schedule.dailyAt.split(':');
          const hours = parseInt(parts[0]);
          const minutes = parseInt(parts[1]);

          if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            this.log.warn(`无效的 dailyAt 时间: ${job.schedule.dailyAt}`);
            job.nextRunAtMs = undefined;
            break;
          }

          const today = new Date();
          today.setHours(hours, minutes, 0, 0);
          if (today.getTime() <= now) {
            today.setDate(today.getDate() + 1);
          }
          job.nextRunAtMs = today.getTime();
        } else {
          job.nextRunAtMs = undefined;
        }
        break;

      case 'cron':
        if (job.schedule.cronExpr) {
          try {
            const interval = CronExpressionParser.parse(job.schedule.cronExpr, {
              currentDate: new Date(now),
              tz: job.schedule.tz
            });
            job.nextRunAtMs = interval.next().getTime();
          } catch {
            this.log.warn(`无效的 cron 表达式: ${job.schedule.cronExpr}`);
            job.nextRunAtMs = undefined;
          }
        } else {
          job.nextRunAtMs = undefined;
        }
        break;
    }
  }

  private async load(): Promise<void> {
    try {
      const jobs = await this.store.getAll();
      for (const job of jobs) {
        this.jobs.set(job.id, job);
      }
    } catch (error) {
      this.log.error('加载定时任务失败', {
        error: normalizeCronError(error)
      });
    }
  }
}
