import { CronRuntimeService, type CronJob } from '../index.js';
import { filePaths } from '../../../platform/utils/paths.js';

export async function createCronRuntime(onCronJob: (job: CronJob) => Promise<void>): Promise<CronRuntimeService> {
  return new CronRuntimeService(
    filePaths.cronJobs(),
    onCronJob
  );
}
