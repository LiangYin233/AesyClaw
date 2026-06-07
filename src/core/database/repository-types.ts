/**
 * repository-types — DatabaseManager 暴露给外部子系统的仓库 API 类型。
 *
 * 每个类型对应 DatabaseManager 上的一个同名属性，
 * 由 initialize() 时一次性构造。外部子系统通过此类型获取最小接口，
 * 避免重复声明相同子集类型。
 */

import type { SessionRepository } from './repositories/session-repository';
import type { CronJobRepository, CronRunRepository } from './repositories/cron-repository';
import type {
  createUsageRecord,
  getUsageStats,
  getTodayUsageSummary,
  getLatestContextUsage,
} from './repositories/usage-repository';
import type {
  createToolUsageRecord,
  getToolUsageStats,
} from './repositories/tool-usage-repository';

/** 会话仓库 API 类型 */
export type SessionsRepository = {
  findOrCreate: SessionRepository['findOrCreate'];
  findByKey: SessionRepository['findByKey'];
  findAll: () => ReturnType<SessionRepository['findAll']>;
  findById: (id: string) => ReturnType<SessionRepository['findById']>;
  deleteById: (id: string) => ReturnType<SessionRepository['deleteWithRelations']>;
  setRole: (id: string, roleId: string) => ReturnType<SessionRepository['setRole']>;
  setModel: (id: string, modelId: string) => ReturnType<SessionRepository['setModel']>;
};

/** 定时任务仓库 API 类型 */
export type CronJobsRepository = {
  create: (params: Parameters<CronJobRepository['createJob']>[0]) => ReturnType<CronJobRepository['createJob']>;
  findById: (id: string) => ReturnType<CronJobRepository['findById']>;
  findAll: () => ReturnType<CronJobRepository['findAll']>;
  delete: (id: string) => ReturnType<CronJobRepository['deleteWithRuns']>;
  updateNextRun: (id: string, nextRun: Date | null) => ReturnType<CronJobRepository['updateNextRun']>;
  update: (id: string, patch: Parameters<CronJobRepository['updateJob']>[1]) => ReturnType<CronJobRepository['updateJob']>;
  setEnabled: (id: string, enabled: boolean) => ReturnType<CronJobRepository['setEnabled']>;
};

/** 定时任务执行仓库 API 类型 */
export type CronRunsRepository = {
  create: (params: { jobId: string }) => ReturnType<CronRunRepository['createRun']>;
  markCompleted: (runId: string, result: string) => ReturnType<CronRunRepository['markCompleted']>;
  markFailed: (runId: string, error: string) => ReturnType<CronRunRepository['markFailed']>;
  markAbandoned: (runIds: string[]) => ReturnType<CronRunRepository['markAbandoned']>;
  findRunning: () => ReturnType<CronRunRepository['findRunning']>;
  findByJobId: (jobId: string) => ReturnType<CronRunRepository['findByJobId']>;
};

/** 用量统计仓库 API 类型 */
export type UsageRepository = {
  create: (record: Parameters<typeof createUsageRecord>[1]) => ReturnType<typeof createUsageRecord>;
  getStats: (options?: Parameters<typeof getUsageStats>[1]) => ReturnType<typeof getUsageStats>;
  getTodaySummary: () => ReturnType<typeof getTodayUsageSummary>;
  getLatestContextUsage: (sessionId: string) => ReturnType<typeof getLatestContextUsage>;
};

/** 工具使用统计仓库 API 类型 */
export type ToolUsageRepository = {
  create: (
    record: Parameters<typeof createToolUsageRecord>[1],
  ) => ReturnType<typeof createToolUsageRecord>;
  getStats: (
    options?: Parameters<typeof getToolUsageStats>[1],
  ) => ReturnType<typeof getToolUsageStats>;
};
