import cron from 'node-cron';
import { cronJobRepository, type CronJobRecord } from './repositories/cron-job-repository.js';
import { logger } from '../observability/logger.js';
import { eventBus, SystemEvents } from '../events/event-bus.js';
import type { SystemEvent } from '../events/event-bus.js';

export interface CronJobExecutor {
  (_job: CronJobRecord): Promise<void>;
}

interface ScheduledTask {
  job: CronJobRecord;
  executeAt: number;
  timeoutId: NodeJS.Timeout | null;
}

class PriorityQueue<T> {
  private heap: T[] = [];
  private comparator: (_a: T, _b: T) => number;

  constructor(comparator: (_a: T, _b: T) => number) {
    this.comparator = comparator;
  }

  push(item: T): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const result = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return result;
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  remove(predicate: (_item: T) => boolean): T | undefined {
    const index = this.heap.findIndex(predicate);
    if (index === -1) return undefined;
    
    const removed = this.heap[index];
    const last = this.heap.pop()!;
    
    if (index < this.heap.length) {
      this.heap[index] = last;
      const parentIndex = Math.floor((index - 1) / 2);
      if (index > 0 && this.comparator(this.heap[index], this.heap[parentIndex]) < 0) {
        this.bubbleUp(index);
      } else {
        this.bubbleDown(index);
      }
    }
    
    return removed;
  }

  getAll(): readonly T[] {
    return this.heap;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.comparator(this.heap[index], this.heap[parentIndex]) >= 0) break;
      [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (leftChild < length && this.comparator(this.heap[leftChild], this.heap[smallest]) < 0) {
        smallest = leftChild;
      }
      if (rightChild < length && this.comparator(this.heap[rightChild], this.heap[smallest]) < 0) {
        smallest = rightChild;
      }
      if (smallest === index) break;

      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}

export class CronJobScheduler {
  private static instance: CronJobScheduler;
  private taskQueue: PriorityQueue<ScheduledTask>;
  private running: boolean = false;
  private executor: CronJobExecutor | null = null;
  private nextTimeoutId: NodeJS.Timeout | null = null;
  private eventSubscriptions: Map<SystemEvent, string> = new Map();

  private constructor() {
    this.taskQueue = new PriorityQueue<ScheduledTask>((a, b) => a.executeAt - b.executeAt);
  }

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
    logger.info({}, 'CronJobScheduler started (Event-Driven Mode)');

    this.eventSubscriptions.set(
      SystemEvents.CRON_JOB_CREATED,
      eventBus.on(SystemEvents.CRON_JOB_CREATED, (payload: { job: CronJobRecord }) => {
        this.scheduleTask(payload.job);
      })
    );

    this.eventSubscriptions.set(
      SystemEvents.CRON_JOB_UPDATED,
      eventBus.on(SystemEvents.CRON_JOB_UPDATED, (payload: { job: CronJobRecord }) => {
        this.rescheduleTask(payload.job);
      })
    );

    this.eventSubscriptions.set(
      SystemEvents.CRON_JOB_DELETED,
      eventBus.on(SystemEvents.CRON_JOB_DELETED, (payload: { jobId: string }) => {
        this.cancelTask(payload.jobId);
      })
    );

    this.eventSubscriptions.set(
      SystemEvents.CRON_JOB_TOGGLED,
      eventBus.on(SystemEvents.CRON_JOB_TOGGLED, (payload: { enabled: boolean; job: CronJobRecord }) => {
        if (payload.enabled) {
          this.scheduleTask(payload.job);
        } else {
          this.cancelTask(payload.job.id);
        }
      })
    );

    this.loadPendingTasks();
    this.scheduleNext();
  }

  stop(): void {
    if (this.nextTimeoutId) {
      clearTimeout(this.nextTimeoutId);
      this.nextTimeoutId = null;
    }

    for (const task of this.taskQueue.getAll()) {
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }
    }

    this.taskQueue = new PriorityQueue<ScheduledTask>((a, b) => a.executeAt - b.executeAt);

    for (const [event, subId] of this.eventSubscriptions) {
      eventBus.off(event, subId);
    }
    this.eventSubscriptions.clear();

    this.running = false;
    logger.info({}, 'CronJobScheduler stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private loadPendingTasks(): void {
    const enabledJobs = cronJobRepository.findEnabled();
    const now = Date.now();

    for (const job of enabledJobs) {
      if (job.nextRunAt) {
        const nextRunTime = new Date(job.nextRunAt).getTime();
        if (nextRunTime > now) {
          this.scheduleTask(job);
        } else {
          const newNextRun = this.calculateNextRunTime(job.cronExpression);
          if (newNextRun) {
            cronJobRepository.setNextRunTime(job.id, newNextRun);
            this.scheduleTask({ ...job, nextRunAt: newNextRun });
          }
        }
      } else {
        const nextRun = this.calculateNextRunTime(job.cronExpression);
        if (nextRun) {
          cronJobRepository.setNextRunTime(job.id, nextRun);
          this.scheduleTask({ ...job, nextRunAt: nextRun });
        }
      }
    }

    logger.info({ taskCount: this.taskQueue.size() }, 'Loaded pending cron tasks');
  }

  private scheduleTask(job: CronJobRecord): void {
    if (!job.enabled || !job.nextRunAt) return;

    const existingTask = this.taskQueue.remove(t => t.job.id === job.id);
    if (existingTask?.timeoutId) {
      clearTimeout(existingTask.timeoutId);
    }

    const executeAt = new Date(job.nextRunAt).getTime();
    const now = Date.now();

    const normalizedExecuteAt = executeAt <= now ? now : executeAt;
    const delay = normalizedExecuteAt - now;
    logger.debug(
      { jobId: job.id, jobName: job.name, delayMs: delay, executeAt: job.nextRunAt },
      '📅 Scheduled task'
    );

    const scheduledTask: ScheduledTask = {
      job,
      executeAt: normalizedExecuteAt,
      timeoutId: null,
    };

    this.taskQueue.push(scheduledTask);
    this.scheduleNext();
  }

  private rescheduleTask(job: CronJobRecord): void {
    this.scheduleTask(job);
  }

  private cancelTask(jobId: string): void {
    const removed = this.taskQueue.remove(t => t.job.id === jobId);
    if (removed?.timeoutId) {
      clearTimeout(removed.timeoutId);
    }

    if (removed) {
      logger.debug({ jobId }, 'Cancelled scheduled task');
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    if (this.nextTimeoutId) {
      clearTimeout(this.nextTimeoutId);
      this.nextTimeoutId = null;
    }

    const nextTask = this.taskQueue.peek();
    if (!nextTask) {
      logger.debug({}, 'No pending tasks');
      return;
    }

    const delay = nextTask.executeAt - Date.now();
    if (delay <= 0) {
      const task = this.taskQueue.pop()!;
      this.executeJob(task.job);
      this.scheduleNext();
      return;
    }

    logger.debug({ jobId: nextTask.job.id, delayMs: delay }, '⏰ Next task scheduled');

    this.nextTimeoutId = setTimeout(() => {
      this.nextTimeoutId = null;
      const task = this.taskQueue.pop();
      if (task) {
        this.executeJob(task.job);
      }
      this.scheduleNext();
    }, delay);
  }

  private async executeJob(job: CronJobRecord): Promise<void> {
    if (!this.executor) {
      logger.error({ jobId: job.id, jobName: job.name }, '无法执行定时任务：执行器未设置');
      cronJobRepository.incrementErrorCount(job.id);
      return;
    }

    try {
      logger.info({ id: job.id, name: job.name }, 'Executing cron job');

      const startTime = Date.now();
      await this.executor(job);
      const executionTime = Date.now() - startTime;

      cronJobRepository.incrementRunCount(job.id);

      const nextRunAt = this.calculateNextRunTime(job.cronExpression);
      if (nextRunAt) {
        cronJobRepository.setNextRunTime(job.id, nextRunAt);
        this.scheduleTask({ ...job, nextRunAt });
      } else {
        cronJobRepository.update(job.id, { enabled: false });
        logger.warn({ jobId: job.id }, 'No next run time calculated, disabling job');
      }

      eventBus.emit(SystemEvents.CRON_JOB_EXECUTED, {
        job,
        executionTime,
        timestamp: new Date().toISOString(),
      });

      logger.info({ id: job.id, executionTime }, 'Cron job executed successfully');
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
      const [range, stepStr] = pattern.split('/');
      const step = parseInt(stepStr, 10);
      if (range === '*') {
        return value % step === 0;
      } else {
        const start = parseInt(range, 10);
        return value >= start && (value - start) % step === 0;
      }
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

  getScheduledTaskCount(): number {
    return this.taskQueue.size();
  }

  getNextScheduledTask(): { jobId: string; executeAt: string; delayMs: number } | null {
    const task = this.taskQueue.peek();
    if (!task) return null;
    return {
      jobId: task.job.id,
      executeAt: task.job.nextRunAt || '',
      delayMs: task.executeAt - Date.now(),
    };
  }
}

export const cronJobScheduler = CronJobScheduler.getInstance();

export function generateCronId(): string {
  return `cron_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
