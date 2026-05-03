/** 数据库记录类型 — 内存与 SQLite 之间的传输对象。 */

// ─── 会话 ──────────────────────────────────────────────────────────

/** 会话的数据库记录 */
export type SessionRecord = {
  id: string;
  channel: string;
  type: string;
  chatId: string;
};

// ─── 定时任务 ──────────────────────────────────────────────────────

/** 定时任务的数据库记录 */
export type CronJobRecord = {
  id: string;
  scheduleType: string;
  scheduleValue: string;
  prompt: string;
  sessionKey: string;
  nextRun: string | null;
  createdAt: string;
};

/** 定时任务执行的数据库记录 */
export type CronRunRecord = {
  id: string;
  jobId: string;
  status: string;
  result: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
};

// ─── 用量 ──────────────────────────────────────────────────────────

/** 用量记录 — 存入数据库前的原始插入载荷 */
export type UsageRecord = {
  model: string;
  provider: string;
  api: string;
  responseId?: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
};

/** 聚合用量汇总（按模型 + 日期分组） */
export type UsageSummary = {
  model: string;
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  count: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  costTotal: number;
};

// ─── 工具 / 技能调用 ───────────────────────────────────────────────

/** 工具/技能调用记录 — 存入数据库前的原始插入载荷 */
export type ToolUsageRecord = {
  name: string;
  type: 'tool' | 'skill';
};

/** 聚合工具/技能调用汇总（按名称 + 类型 + 日期分组） */
export type ToolUsageSummary = {
  name: string;
  type: 'tool' | 'skill';
  date: string;
  count: number;
};
