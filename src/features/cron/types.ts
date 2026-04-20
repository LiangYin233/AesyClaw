import type { CreateCronScheduleInput } from '@/platform/cron/schedule-engine.js';
import type { CronJob } from '@/platform/db/repositories/cron-job-repository.js';

export { CronJob };

export interface CreateCronJobInput {
  name: string;
  prompt: string;
  schedule: CreateCronScheduleInput;
}

export interface CronExecutor {
  execute(job: CronJob): Promise<void>;
}
