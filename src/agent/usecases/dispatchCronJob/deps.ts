import type { SessionReference } from '../../types.js';
import type { CronJob } from '../../../cron/index.js';

export interface DispatchCronJobDeps {
  handleDirect: (
    content: string,
    reference: SessionReference,
    options?: { suppressOutbound?: boolean }
  ) => Promise<string>;
  logInfo: (message: string, fields?: Record<string, unknown>) => void;
  logError: (message: string, fields?: Record<string, unknown>) => void;
  emitExecuted?: (job: CronJob) => Promise<void>;
  emitFailed?: (job: CronJob, error: Error) => Promise<void>;
}
