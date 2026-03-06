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
  messageCount: number
  messages?: any[]
}

export interface Tool {
  name: string
  description: string
  parameters: any
}

export interface Config {
  server: {
    host: string
    port: number
    apiPort: number
    webuiPort?: number
  }
  agent: {
    defaults: {
      model: string
      provider: string
      maxTokens: number
      maxToolIterations: number
      memoryWindow: number
    }
  }
  channels: Record<string, any>
  providers: Record<string, any>
  mcp?: any
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
  files?: { name: string; path: string; isDirectory: boolean }[]
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
