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
  source: 'builtin' | 'external'
  builtin: boolean
  configurable: boolean
  content?: string
  files?: { name: string; path: string; isDirectory: boolean }[]
}

export interface SkillReloadSummary {
  added: string[]
  updated: string[]
  removed: string[]
  total: number
  cleanedAgentRefs: number
}

export interface MemoryEntry {
  key: string
  channel: string
  chatId: string
  activeEntryCount: number
  entries: MemoryRecord[]
  recentOperations: MemoryOperation[]
  sessionCount: number
  summaryCount: number
  conversationSummary?: string
  conversationSummarizedUntilMessageId?: number
  sessions: {
    sessionKey: string
    uuid?: string
    summary: string
    summarizedMessageCount: number
    updatedAt?: string
  }[]
  updatedAt?: string
}

export interface MemoryRecord {
  id: number
  kind: 'profile' | 'preference' | 'project' | 'rule' | 'context' | 'other'
  content: string
  status: 'active' | 'archived' | 'deleted'
  confidence: number
  confirmations: number
  createdAt?: string
  updatedAt?: string
  lastSeenAt?: string
}

export interface MemoryOperation {
  id: number
  entryId?: number
  action: 'create' | 'update' | 'merge' | 'archive' | 'delete'
  actor: 'background' | 'tool' | 'api' | 'migration'
  reason?: string
  before?: any
  after?: any
  evidence: string[]
  createdAt?: string
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

export interface LoggingConfig {
  level: string
  bufferSize: number
}

export interface ObservabilityLogEntry {
  id: string
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  scope: string
  message: string
  fields?: Record<string, string | number | boolean | null>
}

export interface LoggingEntriesResponse {
  entries: ObservabilityLogEntry[]
  total: number
  bufferSize: number
  level: string
}

export interface TokenUsageStats {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  requestCount: number
  lastUpdated: string
  daily: TokenUsageDailyStat[]
}

export interface TokenUsageDailyStat {
  date: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  requestCount: number
  lastUpdated?: string
}
