import { join } from 'path';
import { CronService } from '../../cron/index.js';
import type { CronJob } from '../../cron/index.js';

export async function createCronService(onCronJob?: (job: CronJob) => Promise<void>): Promise<CronService> {
  return new CronService(
    join(process.cwd(), '.aesyclaw', 'cron-jobs.json'),
    onCronJob || (async () => {})
  );
}
