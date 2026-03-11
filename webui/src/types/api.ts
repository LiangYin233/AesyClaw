// API Type Definitions

export interface Status {
  version: string
  uptime: number
  channels: any
  sessions: number
  agentRunning: boolean
}

export interface Session {
  key: string
  channel?: string
  chatId?: string
  uuid?: string
  agentName?: string
  messageCount: number
  messages?: any[]
}

export interface BatchDeleteResult {
  successKeys: string[]
  failed: Array<{
    key: string
    error: string
  }>
}

export interface AgentRoleConfig {
  name: string
  description?: string
  systemPrompt: string
  provider: string
  model: string
  allowedSkills: string[]
  allowedTools: string[]
}

export interface AgentRole extends AgentRoleConfig {
  builtin: boolean
  availableSkills: string[]
  availableTools: string[]
  missingSkills: string[]
  missingTools: string[]
}

export interface SetSessionAgentPayload {
  agentName: string | null
}

export interface Tool {
  name: string
  description: string
  parameters: any
}

export interface MCPServerConfig {
  type: 'local' | 'http'
  command?: string | string[]
  url?: string
  environment?: string | Record<string, string>
  enabled?: boolean
  timeout?: number
}

export type MCPServerStatus = 'connecting' | 'connected' | 'failed' | 'disconnected'

export interface MCPServerInfo {
  name: string
  status: MCPServerStatus
  config: MCPServerConfig
  connectedAt?: string
  error?: string
  toolCount: number
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: any
}

export interface Config {
  server: {
    host: string
    port?: number
    apiPort: number
    webuiPort?: number
    token?: string
    apiEnabled?: boolean
  }
  agent: {
    defaults: {
      model: string
      provider: string
      vision?: boolean
      reasoning?: boolean
      visionProvider?: string
      visionModel?: string
      maxTokens?: number
      maxToolIterations: number
      memoryWindow: number
      systemPrompt?: string
      contextMode?: 'session' | 'channel' | 'global'
      maxSessions?: number
      memorySummary?: {
        enabled?: boolean
        provider?: string
        model?: string
        triggerMessages?: number
      }
      memoryFacts?: {
        enabled?: boolean
        provider?: string
        model?: string
        maxFacts?: number
      }
    }
  }
  agents?: {
    roles: Record<string, AgentRoleConfig>
  }
  channels: Record<string, any>
  providers: Record<string, any>
  mcp?: Record<string, MCPServerConfig>
}

export interface CronJob {
  id: string
  name: string
  enabled: boolean
  schedule: {
    kind: 'once' | 'interval' | 'daily' | 'cron'
    onceAt?: string
    intervalMs?: number
    dailyAt?: string
    cronExpr?: string
  }
  payload: {
    description: string
    detail: string
    channel?: string
    target?: string
  }
  nextRunAtMs?: number
  lastRunAtMs?: number
}

export interface PluginInfo {
  name: string
  version: string
  description?: string
  author?: string
  enabled: boolean
  options?: Record<string, any>
  defaultConfig?: Record<string, any>
  toolsCount: number
}

export interface SkillInfo {
  name: string
  description: string
  path: string
  enabled: boolean
  content?: string
  files?: { name: string; path: string; isDirectory: boolean }[]
}

export interface MemoryEntry {
  key: string
  channel: string
  chatId: string
  facts: string[]
  factCount: number
  sessionCount: number
  summaryCount: number
  sessions: {
    sessionKey: string
    uuid?: string
    summary: string
    summarizedMessageCount: number
    updatedAt?: string
  }[]
  updatedAt?: string
}

export interface ApiResponse<T> {
  data: T | null
  error: string | null
}

export interface ApiError {
  message: string
  status?: number
  details?: any
}

export interface LogConfig {
  level: string
  prefix: string
}

export interface MetricStats {
  name: string
  count: number
  sum: number
  min: number
  max: number
  mean: number
  p50: number
  p95: number
  p99: number
}

export interface MetricOverview {
  totalMetrics: number
  totalDataPoints: number
  memoryUsage: {
    heapUsed: number
    heapTotal: number
    external: number
    rss: number
  }
}

export interface MetricConfig {
  enabled: boolean
  maxDataPoints: number
  retentionMs: number
}

export interface MemoryUsage {
  heapUsed: number
  heapTotal: number
  external: number
  rss: number
  arrayBuffers: number
}
