import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { logger } from '../logger/index.js';

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  nextRunAtMs?: number;
  lastRunAtMs?: number;
}

export interface CronSchedule {
  kind: 'once' | 'interval' | 'daily' | 'cron';
  onceAt?: string;
  intervalMs?: number;
  dailyAt?: string;
  cronExpr?: string;
  tz?: string;
}

export interface CronPayload {
  description: string;
  detail: string;
  channel?: string;
  target?: string;
}

export function parseTarget(target: string): { messageType: 'private' | 'group'; chatId: string } | null {
  const match = target.match(/^(private|group):(\d+)$/);
  if (!match) return null;
  
  return {
    messageType: match[1] as 'private' | 'group',
    chatId: match[2]
  };
}

export class CronService {
  private jobs: Map<string, CronJob> = new Map();
  private timer?: NodeJS.Timeout;
  private storePath: string;
  private onJobExecute?: (job: CronJob) => Promise<void>;
  private log = logger.child({ prefix: 'Cron' });

  constructor(
    storePath: string,
    onJobExecute?: (job: CronJob) => Promise<void>
  ) {
    this.storePath = storePath;
    this.onJobExecute = onJobExecute;
  }

  addJob(job: CronJob): CronJob {
    this.computeNextRun(job);
    this.jobs.set(job.id, job);
    this.save();
    this.log.info(`Added job: ${job.name} (${job.id}), next run: ${job.nextRunAtMs ? new Date(job.nextRunAtMs).toISOString() : 'N/A'}`);
    this.wakeUp();
    return job;
  }

  removeJob(id: string): boolean {
    const result = this.jobs.delete(id);
    this.save();
    if (result) {
      this.log.info(`Removed job: ${id}`);
    }
    return result;
  }

  enableJob(id: string, enabled: boolean): void {
    const job = this.jobs.get(id);
    if (job) {
      job.enabled = enabled;
      this.computeNextRun(job);
      this.save();
      this.log.info(`Job ${id} ${enabled ? 'enabled' : 'disabled'}, next run: ${job.nextRunAtMs ? new Date(job.nextRunAtMs).toISOString() : 'N/A'}`);
      this.wakeUp();
    }
  }

  getJob(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }

  listJobs(): CronJob[] {
    return Array.from(this.jobs.values()).map(job => ({
      ...job,
      payload: {
        ...job.payload,
        detail: '[隐藏]'
      }
    }));
  }

  async start(): Promise<void> {
    this.load();
    this.scheduleNext();
    this.log.info(`Service started, ${this.jobs.size} jobs loaded`);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.log.info('Service stopped');
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
      this.log.debug('No jobs scheduled');
      return;
    }

    const delay = Math.max(0, nearest - now);
    this.log.debug(`Next job in ${Math.round(delay / 1000)}s`);

    this.timer = setTimeout(async () => {
      await this.runDueJobs();
      this.scheduleNext();
    }, delay);
  }

  private async runDueJobs(): Promise<void> {
    const now = Date.now();

    for (const job of this.jobs.values()) {
      if (job.enabled && job.nextRunAtMs && now >= job.nextRunAtMs) {
        this.log.info(`Executing job: ${job.name} (${job.id})`);

        if (this.onJobExecute) {
          try {
            await this.onJobExecute(job);
            this.log.info(`Job ${job.id} completed successfully`);
          } catch (error: any) {
            this.log.error(`Job ${job.id} failed:`, error.message);
          }
        }

        job.lastRunAtMs = now;
        this.computeNextRun(job);
      }
    }

    this.save();
  }

  computeNextRun(job: CronJob): void {
    const now = Date.now();

    switch (job.schedule.kind) {
      case 'once':
        if (job.schedule.onceAt) {
          const atMs = new Date(job.schedule.onceAt).getTime();
          job.nextRunAtMs = atMs > now ? atMs : undefined;
        } else {
          job.nextRunAtMs = undefined;
        }
        break;

      case 'interval':
        if (job.schedule.intervalMs && job.schedule.intervalMs > 0) {
          job.nextRunAtMs = now + job.schedule.intervalMs;
        } else {
          job.nextRunAtMs = undefined;
        }
        break;

      case 'daily':
        if (job.schedule.dailyAt) {
          const [hours, minutes] = job.schedule.dailyAt.split(':').map(Number);
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
          job.nextRunAtMs = this.parseCronNext(job.schedule.cronExpr, now);
        } else {
          job.nextRunAtMs = undefined;
        }
        break;
    }
  }

  private parseCronNext(cronExpr: string, now: number): number {
    const parts = cronExpr.split(' ');
    if (parts.length < 5) {
      this.log.warn(`Invalid cron expression: ${cronExpr}`);
      return now + 60000;
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    
    const validatePart = (part: string, min: number, max: number, name: string): boolean => {
      if (part === '*') return true;
      
      if (part.includes('/')) {
        const [range, step] = part.split('/');
        const stepNum = parseInt(step);
        if (isNaN(stepNum) || stepNum <= 0) {
          this.log.warn(`Invalid cron step in ${name}: ${step}`);
          return false;
        }
        if (range !== '*') {
          if (range.includes('-')) {
            const [start, end] = range.split('-').map(Number);
            if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
              this.log.warn(`Invalid cron range in ${name}: ${range}`);
              return false;
            }
          } else {
            const val = parseInt(range);
            if (isNaN(val) || val < min || val > max) {
              this.log.warn(`Invalid cron value in ${name}: ${range}`);
              return false;
            }
          }
        }
        return true;
      }

      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
          this.log.warn(`Invalid cron range in ${name}: ${part}`);
          return false;
        }
        return true;
      }

      if (part.includes(',')) {
        const vals = part.split(',').map(Number);
        for (const v of vals) {
          if (isNaN(v) || v < min || v > max) {
            this.log.warn(`Invalid cron list value in ${name}: ${v}`);
            return false;
          }
        }
        return true;
      }

      const val = parseInt(part);
      if (isNaN(val) || val < min || val > max) {
        this.log.warn(`Invalid cron value in ${name}: ${part}`);
        return false;
      }
      return true;
    };

    if (!validatePart(minute, 0, 59, 'minute')) return now + 60000;
    if (!validatePart(hour, 0, 23, 'hour')) return now + 60000;
    if (!validatePart(dayOfMonth, 1, 31, 'dayOfMonth')) return now + 60000;
    if (!validatePart(month, 1, 12, 'month')) return now + 60000;
    if (!validatePart(dayOfWeek, 0, 6, 'dayOfWeek')) return now + 60000;

    const date = new Date(now);
    date.setSeconds(0, 0);
    
    const maxIterations = 366 * 24 * 60;
    
    for (let i = 0; i < maxIterations; i++) {
      date.setMinutes(date.getMinutes() + 1);

      if (this.matchCronPart(minute, date.getMinutes()) &&
          this.matchCronPart(hour, date.getHours()) &&
          this.matchCronPart(dayOfMonth, date.getDate()) &&
          this.matchCronPart(month, date.getMonth() + 1) &&
          this.matchCronPart(dayOfWeek, date.getDay())) {
        return date.getTime();
      }
    }

    return now + 60000;
  }

  private matchCronPart(part: string, value: number): boolean {
    if (part === '*') return true;

    if (part.includes('/')) {
      const [, step] = part.split('/');
      return value % parseInt(step) === 0;
    }

    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      return value >= start && value <= end;
    }

    if (part.includes(',')) {
      return part.split(',').map(Number).includes(value);
    }

    return parseInt(part) === value;
  }

  private load(): void {
    if (!existsSync(this.storePath)) {
      return;
    }

    try {
      const content = readFileSync(this.storePath, 'utf-8');
      const jobs: CronJob[] = JSON.parse(content);
      for (const job of jobs) {
        this.jobs.set(job.id, job);
      }
    } catch (error) {
      this.log.error('Failed to load jobs:', error);
    }
  }

  private save(): void {
    const dir = dirname(this.storePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const jobs = Array.from(this.jobs.values());
    writeFileSync(this.storePath, JSON.stringify(jobs, null, 2), 'utf-8');
  }
}
