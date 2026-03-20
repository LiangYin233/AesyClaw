import { logger } from '../../observability/index.js';
import type { Services } from '../factory/ServiceFactory.js';
import type { CronJob } from '../../cron/index.js';
import { dispatchCronJob as dispatchCronJobUsecase } from '../../agent/core-usecases/index.js';

const log = logger.child('Bootstrap');
export async function dispatchCronJob(services: Services, workspace: string, job: CronJob): Promise<void> {
  void workspace;
  await dispatchCronJobUsecase({
    handleDirect: (content, reference, options) => services.agentRuntime.handleDirect(content, reference, options),
    logInfo: (message, fields) => log.info(message, fields),
    logError: (message, fields) => log.error(message, fields),
    emitExecuted: async (cronJob) => {
      await services.eventBus.emit('cron.job.executed', {
        jobId: cronJob.id,
        jobName: cronJob.name,
        target: cronJob.payload.target
      });
    },
    emitFailed: async (cronJob, error) => {
      await services.eventBus.emit('cron.job.failed', {
        jobId: cronJob.id,
        jobName: cronJob.name,
        target: cronJob.payload.target,
        error
      });
    }
  }, {
    job
  });
}
