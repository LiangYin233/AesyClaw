/** Database record for a session */
export interface SessionRecord {
  id: string;
  channel: string;
  type: string;
  chatId: string;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Database record for a cron job */
export interface CronJobRecord {
  id: string;
  scheduleType: string;
  scheduleValue: string;
  prompt: string;
  sessionKey: string;
  nextRun: string | null;
  createdAt: string;
}

/** Database record for a cron run */
export interface CronRunRecord {
  id: string;
  jobId: string;
  status: string;
  result: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

/** Usage record — raw insert payload before DB storage */
export interface UsageRecord {
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
}

/** Aggregated usage summary (grouped by model + date) */
export interface UsageSummary {
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
}
