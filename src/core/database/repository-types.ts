/**
 * repository-types — DatabaseManager 暴露给外部子系统的仓库 API 类型。
 *
 * 每个类型对应 DatabaseManager 上的一个同名属性，
 * 由 initialize() 时一次性构造。外部子系统通过此类型获取最小接口，
 * 避免重复声明相同子集类型。
 */

import type {
  findOrCreateSession,
  findSessionByKey,
  findAllSessions,
  findAllSessionSummaries,
  findSessionById,
  deleteSessionByKey,
} from './repositories/session-repository';
import type {
  saveMessage,
  loadMessageHistory,
  clearMessageHistory,
  replaceMessageWithSummary,
} from './repositories/message-repository';
import type {
  getActiveRoleBinding,
  setActiveRoleBinding,
} from './repositories/role-binding-repository';
import type {
  createCronJob,
  findCronJobById,
  findAllCronJobs,
  deleteCronJob,
  updateCronJobNextRun,
  createCronRun,
  markCronRunCompleted,
  markCronRunFailed,
  markCronRunsAbandoned,
  findRunningCronRuns,
  findCronRunsByJobId,
} from './repositories/cron-repository';
import type {
  createUsageRecord,
  getUsageStats,
  getTodayUsageSummary,
} from './repositories/usage-repository';
import type {
  createToolUsageRecord,
  getToolUsageStats,
} from './repositories/tool-usage-repository';

/** 会话仓库 API 类型 */
export type SessionsRepository = {
  findOrCreate: (
    key: Parameters<typeof findOrCreateSession>[1],
  ) => ReturnType<typeof findOrCreateSession>;
  findByKey: (key: Parameters<typeof findSessionByKey>[1]) => ReturnType<typeof findSessionByKey>;
  findAll: () => ReturnType<typeof findAllSessions>;
  findAllSummaries: () => ReturnType<typeof findAllSessionSummaries>;
  findById: (id: string) => ReturnType<typeof findSessionById>;
  deleteByKey: (
    key: Parameters<typeof deleteSessionByKey>[1],
  ) => ReturnType<typeof deleteSessionByKey>;
};

/** 消息仓库 API 类型 */
export type MessagesRepository = {
  save: (
    sessionId: string,
    message: Parameters<typeof saveMessage>[2],
  ) => ReturnType<typeof saveMessage>;
  loadHistory: (sessionId: string) => ReturnType<typeof loadMessageHistory>;
  clearHistory: (sessionId: string) => ReturnType<typeof clearMessageHistory>;
  replaceWithSummary: (
    sessionId: string,
    summary: string,
  ) => ReturnType<typeof replaceMessageWithSummary>;
};

/** 角色绑定仓库 API 类型 */
export type RoleBindingsRepository = {
  getActiveRole: (sessionId: string) => ReturnType<typeof getActiveRoleBinding>;
  setActiveRole: (sessionId: string, roleId: string) => ReturnType<typeof setActiveRoleBinding>;
};

/** 定时任务仓库 API 类型 */
export type CronJobsRepository = {
  create: (params: Parameters<typeof createCronJob>[1]) => ReturnType<typeof createCronJob>;
  findById: (id: string) => ReturnType<typeof findCronJobById>;
  findAll: () => ReturnType<typeof findAllCronJobs>;
  delete: (id: string) => ReturnType<typeof deleteCronJob>;
  updateNextRun: (id: string, nextRun: Date | null) => ReturnType<typeof updateCronJobNextRun>;
};

/** 定时任务执行仓库 API 类型 */
export type CronRunsRepository = {
  create: (params: { jobId: string }) => ReturnType<typeof createCronRun>;
  markCompleted: (runId: string, result: string) => ReturnType<typeof markCronRunCompleted>;
  markFailed: (runId: string, error: string) => ReturnType<typeof markCronRunFailed>;
  markAbandoned: (runIds: string[]) => ReturnType<typeof markCronRunsAbandoned>;
  findRunning: () => ReturnType<typeof findRunningCronRuns>;
  findByJobId: (jobId: string) => ReturnType<typeof findCronRunsByJobId>;
};

/** 用量统计仓库 API 类型 */
export type UsageRepository = {
  create: (record: Parameters<typeof createUsageRecord>[1]) => ReturnType<typeof createUsageRecord>;
  getStats: (options?: Parameters<typeof getUsageStats>[1]) => ReturnType<typeof getUsageStats>;
  getTodaySummary: () => ReturnType<typeof getTodayUsageSummary>;
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
