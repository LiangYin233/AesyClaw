/** Cron Service。 */

import type { WebRuntimeDependencies } from '@aesyclaw/web/types';

/**
 * 获取所有 cron 任务列表。
 *
 * @param deps - WebUI 管理器依赖项
 * @returns cron 任务列表
 */
export async function getCronJobs(deps: WebRuntimeDependencies): Promise<unknown> {
  const jobs = await deps.cronManager.listJobs();
  return jobs;
}

/**
 * 获取指定 cron 任务的执行记录。
 *
 * @param deps - WebUI 管理器依赖项
 * @param jobId - cron 任务 ID
 * @returns 执行记录列表
 */
export async function getCronJobRuns(
  deps: WebRuntimeDependencies,
  jobId: string,
): Promise<unknown> {
  const runs = await deps.databaseManager.cronRuns.findByJobId(jobId);
  return runs;
}
