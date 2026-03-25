import { join } from 'path';
import { CronService, type CronJob } from '../../cron/index.js';

export async function createCronRuntime(onCronJob?: (job: CronJob) => Promise<void>): Promise<CronService> {
  return new CronService(
    join(process.cwd(), '.aesyclaw', 'cron-jobs.json'),
    onCronJob || (async () => {})
  );
}
