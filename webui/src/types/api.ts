// API Type Definitions

import type {
  AgentRoleConfig as SharedAgentRoleConfig,
  Config as SharedConfig,
  MCPServerConfig as SharedMCPServerConfig
} from '../../../src/config/schema.ts'

export interface Status {
  version: string
  uptime: number
  channels: Record<string, ChannelStatus>
  sessions: number
  agentRunning: boolean
}

export interface ChannelStatus {
  enabled?: boolean
  connected?: boolean
  running?: boolean
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

export type AgentRoleConfig = SharedAgentRoleConfig

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

export type MCPServerConfig = SharedMCPServerConfig

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

export type Config = SharedConfig

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

export interface LogEntry {
  id: string
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  prefix: string
  message: string
  context?: string
  line: string
}

export interface LogsResponse {
  entries: LogEntry[]
  total: number
  bufferSize: number
  level: string
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
