import type { PluginContext } from '@aesyclaw/sdk';

export function getCronJobs(ctx: PluginContext): ReturnType<PluginContext['control']['cron']['list']> {
  return ctx.control.cron.list();
}

export function getCronJobRuns(
  ctx: PluginContext,
  jobId: string,
): ReturnType<PluginContext['control']['cron']['getRuns']> {
  return ctx.control.cron.getRuns(jobId);
}
