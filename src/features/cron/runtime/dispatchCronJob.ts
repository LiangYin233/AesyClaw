import { dispatchCronJob as dispatchCronJobUsecase } from '../../../agent/application/index.js';
import type { CronJob } from '../index.js';
import { logger } from '../../../platform/observability/index.js';
import type { Services } from '../../../app/bootstrap/factory/ServiceFactory.js';

const log = logger.child('Bootstrap');

export async function dispatchCronJob(services: Services, job: CronJob): Promise<void> {
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
