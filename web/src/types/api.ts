export interface ToolPermission {
  mode: 'allowlist' | 'denylist';
  list?: string[];
}

export interface Role {
  id: string;
  description: string;
  systemPrompt: string;
  model: string;
  toolPermission: ToolPermission;
  skills: string[];
  enabled: boolean;
}

export interface Session {
  id: string;
  channel: string;
  type: string;
  chatId: string;
  lastActivity?: string;
}

export interface PersistableMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface UsageSummary {
  model: string;
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  count: number;
}

export interface ToolUsageSummary {
  name: string;
  type: 'tool' | 'skill';
  date: string;
  count: number;
}

export interface ChannelStatus {
  name: string;
  description?: string;
  enabled: boolean;
  state: 'loaded' | 'disabled' | 'unloaded' | 'failed';
  version?: string;
  error?: string;
}

export interface CronJobRecord {
  id: string;
  scheduleType: 'once' | 'daily' | 'interval';
  scheduleValue: string;
  prompt: string;
  sessionKey: string;
  nextRun: string | null;
  createdAt: string;
}

export interface CronRunRecord {
  id: string;
  jobId: string;
  startedAt: string;
  status: 'completed' | 'failed' | 'running' | 'abandoned';
  result: string | null;
  error: string | null;
  endedAt: string | null;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  details: string | null;
  formatted: string;
}

export interface LogsResponse {
  entries: LogEntry[];
  limit: number;
}
