import type { CronJob } from '@/platform/db/repositories/cron-job-repository.js';

export { CronJob };

export interface CreateCronJobInput {
  name: string;
  cronExpression: string;
  prompt: string;
}

export interface UpdateCronJobInput {
  name?: string;
  cronExpression?: string;
  prompt?: string;
}

export interface CronExecutor {
  execute(job: CronJob): Promise<void>;
}
