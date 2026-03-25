import { join } from 'path';
import { CronRuntimeService, type CronJob } from '../index.js';

export async function createCronRuntime(onCronJob?: (job: CronJob) => Promise<void>): Promise<CronRuntimeService> {
  return new CronRuntimeService(
    join(process.cwd(), '.aesyclaw', 'cron-jobs.json'),
    onCronJob || (async () => {})
  );
}
