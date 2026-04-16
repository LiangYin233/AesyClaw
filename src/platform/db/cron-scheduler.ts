import type { CronJobRecord } from './repositories/cron-job-repository.js';
import { cronService, type CronJobExecutor } from './cron-service.js';

export class CronJobScheduler {
  private static instance: CronJobScheduler;

  static getInstance(): CronJobScheduler {
    if (!CronJobScheduler.instance) {
      CronJobScheduler.instance = new CronJobScheduler();
    }
    return CronJobScheduler.instance;
  }

  setExecutor(executor: CronJobExecutor): void {
    cronService.setExecutor(executor);
  }

  start(): void {
    cronService.start();
  }

  stop(): Promise<void> {
    return cronService.stop();
  }

  isRunning(): boolean {
    return cronService.isRunning();
  }

  calculateNextRunTime(cronExpression: string): string | null {
    return cronService.calculateNextRunTime(cronExpression);
  }

  validateCronExpression(expression: string): boolean {
    return cronService.validateCronExpression(expression);
  }

  getScheduledTaskCount(): number {
    return cronService.getScheduledTaskCount();
  }
}

export const cronJobScheduler = CronJobScheduler.getInstance();

export function generateCronId(): string {
  return `cron_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export type { CronJobRecord };
