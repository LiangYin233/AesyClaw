/** Cron Service。 */

import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';

/**
 * 获取所有 cron 任务列表。
 */
export async function getCronJobs(deps: WebUiManagerDependencies): Promise<unknown> {
  const jobs = await deps.cronManager.listJobs();
  return jobs;
}

/**
 * 获取指定 cron 任务的执行记录。
 */
export async function getCronJobRuns(
  deps: WebUiManagerDependencies,
  jobId: string,
): Promise<unknown> {
  const runs = await deps.databaseManager.cronRuns.findByJobId(jobId);
  return runs;
}
