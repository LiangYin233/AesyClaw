export interface ToolPermission {
  mode: 'allowlist' | 'denylist';
  list?: string[];
}

export interface Role {
  id: string;
  description: string;
  systemPrompt: string;
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
  role: 'user' | 'assistant' | 'toolResult';
  content: string;
  timestamp?: string;
  /** 工具调用/结果的结构化数据 */
  toolCalls?: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>;
  toolResult?: { toolCallId: string; toolName: string; isError: boolean; details?: unknown };
  /** 兼容旧协议 */
  toolData?: string;
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
}

export interface StatusResponse {
  version?: string;
  uptime: number;
  channels: ChannelStatus[];
  database: {
    sessions: number;
    messages: number;
    cronJobs: number;
  };
}
