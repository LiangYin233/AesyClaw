export interface ChannelStatus {
  enabled?: boolean;
  connected?: boolean;
  running?: boolean;
}

export interface StatusResponse {
  version: string;
  uptime: number;
  channels: Record<string, ChannelStatus>;
  sessions: number;
  agentRunning: boolean;
}

export interface Session {
  key: string;
  channel?: string;
  chatId?: string;
  uuid?: string;
  agentName?: string;
  messageCount: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface SessionDetail extends Session {
  messages: SessionMessage[];
}

export interface AgentRoleConfig {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  allowedSkills: string[];
  allowedTools: string[];
}

export interface AgentRole extends AgentRoleConfig {
  builtin: boolean;
  provider: string;
  reasoning: boolean;
  vision: boolean;
  availableSkills: string[];
  availableTools: string[];
  missingSkills: string[];
  missingTools: string[];
}

export interface TokenUsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  lastUpdated: string;
  daily: Array<{
    date: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requestCount: number;
    lastUpdated?: string;
  }>;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ObservabilityLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  fields?: Record<string, string | number | boolean | null>;
}

export interface ObservabilityLoggingConfig {
  level: LogLevel;
  bufferSize: number;
}

export interface ObservabilityEntriesResponse {
  entries: ObservabilityLogEntry[];
  total: number;
  bufferSize: number;
  level: LogLevel;
}

export interface MCPServerInfo {
  name: string;
  status: 'connecting' | 'connected' | 'failed' | 'disconnected';
  config: {
    enabled: boolean;
    type?: 'local' | 'http';
    command?: string[];
    url?: string;
    timeout?: number;
    environment?: Record<string, string>;
    headers?: Record<string, string>;
  };
  connectedAt?: string;
  error?: string;
  toolCount: number;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  files?: Array<{
    name: string;
    path: string;
    isDirectory: boolean;
  }>;
  content?: string;
  enabled: boolean;
  source: 'builtin' | 'external';
  builtin: boolean;
  configurable: boolean;
}

export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ProviderType = 'openai' | 'openai_responses' | 'anthropic';

export interface ProviderModelConfig {
  maxContextTokens?: number;
  reasoning?: boolean;
  supportsVision?: boolean;
}

export interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  apiBase?: string;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  models?: Record<string, ProviderModelConfig>;
}

export interface PluginInfo {
  name: string;
  version: string;
  description?: string;
  author?: string;
  enabled: boolean;
  options?: Record<string, unknown>;
  defaultConfig?: {
    enabled?: boolean;
    options?: Record<string, unknown>;
  };
  toolsCount: number;
  kind?: 'plugin' | 'channel';
  channelName?: string;
  running?: boolean;
}

export interface CronSchedule {
  kind: 'once' | 'interval' | 'daily' | 'cron';
  onceAt?: string;
  intervalMs?: number;
  dailyAt?: string;
  cronExpr?: string;
  tz?: string;
}

export interface CronPayload {
  description: string;
  detail: string;
  channel?: string;
  target?: string;
}

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  nextRunAtMs?: number;
  lastRunAtMs?: number;
}

export interface MemoryEntry {
  id: number;
  kind: string;
  content: string;
  status: string;
  confidence: number;
  confirmations: number;
  createdAt?: string;
  updatedAt?: string;
  lastSeenAt?: string;
}

export interface MemoryOperation {
  id: number;
  entryId?: number;
  action: string;
  actor: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  evidence: string[];
  createdAt?: string;
}

export interface MemorySessionSnapshot {
  sessionKey: string;
  uuid?: string;
  summary: string;
  summarizedMessageCount: number;
  updatedAt?: string;
}

export interface MemoryConversationItem {
  key: string;
  channel: string;
  chatId: string;
  activeEntryCount: number;
  entries: MemoryEntry[];
  recentOperations: MemoryOperation[];
  sessionCount: number;
  summaryCount: number;
  conversationSummary?: string;
  conversationSummarizedUntilMessageId?: number;
  sessions: MemorySessionSnapshot[];
  updatedAt?: string;
}

export interface AppConfig {
  server?: {
    host?: string;
    apiPort?: number;
    apiEnabled?: boolean;
  };
  agent?: {
    defaults?: {
      maxToolIterations?: number;
      memoryWindow?: number;
      maxSessions?: number;
      contextMode?: 'session' | 'channel';
      visionFallbackModel?: string;
      memorySummary?: {
        enabled?: boolean;
        model?: string;
        compressRounds?: number;
      };
      memoryFacts?: {
        enabled?: boolean;
        model?: string;
        retrievalModel?: string;
        retrievalThreshold?: number;
        retrievalTopK?: number;
      };
    };
  };
  providers?: Record<string, ProviderConfig>;
  agents?: {
    roles?: {
      main?: Partial<AgentRoleConfig>;
      [name: string]: Partial<AgentRoleConfig> | undefined;
    };
  };
  channels?: Record<string, { enabled?: boolean } & Record<string, unknown>>;
  plugins?: Record<string, { enabled?: boolean; options?: Record<string, unknown> }>;
  skills?: Record<string, { enabled?: boolean }>;
  mcp?: Record<string, {
    enabled?: boolean;
    type?: 'local' | 'http';
    url?: string;
    command?: string[];
    timeout?: number;
    environment?: Record<string, string>;
    headers?: Record<string, string>;
  }>;
  observability?: {
    level?: LogLevel;
  };
  tools?: {
    timeoutMs?: number;
  };
}
