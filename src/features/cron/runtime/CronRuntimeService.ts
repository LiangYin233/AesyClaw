import { CronExpressionParser } from 'cron-parser';
import { logger } from '../../../platform/observability/index.js';
import { formatLocalTimestamp } from '../../../platform/observability/logging.js';
import type { CronJob } from '../domain/cronTypes.js';
import { CronStore } from '../infrastructure/CronStore.js';
import { normalizeCronError } from '../shared/errors.js';

const FAILED_JOB_RETRY_DELAY_MS = 60_000;

export class CronRuntimeService {
  private jobs: Map<string, CronJob> = new Map();
  private timer?: NodeJS.Timeout;
  private store: CronStore;
  private onJobExecute?: (job: CronJob) => Promise<void>;
  private log = logger.child('Cron');

  constructor(
    dbPath: string,
    onJobExecute?: (job: CronJob) => Promise<void>
  ) {
    const actualDbPath = dbPath.replace(/\.json$/, '.db');
    this.store = new CronStore(actualDbPath);
    this.onJobExecute = onJobExecute;
  }

  addJob(job: CronJob): CronJob {
    this.computeNextRun(job);
    this.jobs.set(job.id, job);
    this.store.upsert(job).catch((err) => this.log.error('保存任务失败:', err));
    this.log.info('定时任务已创建', {
      jobId: job.id,
      jobName: job.name,
      kind: job.schedule.kind,
      nextRunAt: job.nextRunAtMs ? formatLocalTimestamp(new Date(job.nextRunAtMs)) : undefined,
      target: job.payload.target
    });
    this.wakeUp();
    return job;
  }

  removeJob(id: string): boolean {
    const result = this.jobs.delete(id);
    this.store.delete(id).catch((err) => this.log.error('删除任务失败:', err));
    if (result) this.log.info('定时任务已删除', { jobId: id });
    return result;
  }

  enableJob(id: string, enabled: boolean): void {
    const job = this.jobs.get(id);
    if (job) {
      job.enabled = enabled;
      this.computeNextRun(job);
      this.store.updateStatus(id, enabled, job.nextRunAtMs).catch((err) => this.log.error('更新任务状态失败:', err));
      this.log.info('定时任务状态已更新', {
        jobId: id,
        enabled,
        nextRunAt: job.nextRunAtMs ? formatLocalTimestamp(new Date(job.nextRunAtMs)) : undefined
      });
      this.wakeUp();
    }
  }

  getJob(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }

  listJobs(): CronJob[] {
    return Array.from(this.jobs.values()).map((job) => ({
      ...job,
      payload: { ...job.payload, detail: '[隐藏]' }
    }));
  }

  async start(): Promise<void> {
    await this.store.initialize();
    await this.load();
    this.scheduleNext();
    this.log.info('定时任务服务已启动', { jobCount: this.jobs.size });
  }

  stop(): void {
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
      this.store.delete(id).catch((err) => this.log.error('删除任务失败', {
        jobId: id,
        error: normalizeCronError(err)
      }));
      this.log.info('一次性定时任务已移除', { jobId: id });
    }

    if (toUpdate.length > 0) {
      this.store.batchUpdate(toUpdate).catch((err) => this.log.error('批量更新任务失败', {
        count: toUpdate.length,
        error: normalizeCronError(err)
      }));
    }

    for (const update of statusUpdates) {
      this.store.updateStatus(update.id, update.enabled, update.nextRunAtMs).catch((err) => this.log.error('更新任务状态失败', {
        jobId: update.id,
        error: normalizeCronError(err)
      }));
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
