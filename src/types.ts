export interface InboundFile {
  name: string;
  url: string;
  localPath?: string;  // Channel 下载后的本地路径
  type?: 'audio' | 'video' | 'file' | 'image';  // 文件类型，用于插件识别
}

/**
 * 插件处理意图 - 描述插件如何处理消息以及 Agent 应该如何响应
 */
export type ProcessingIntent =
  | { type: 'continue' }                    // 继续 LLM 处理（默认）
  | { type: 'reply', reason: string }       // 直接回复，跳过 LLM
  | { type: 'handled', reason: string }     // 插件已完全处理（已调用 LLM）
  | { type: 'status', reason: string }      // 状态提示消息
  | { type: 'error', reason: string };      // 错误消息

export interface InboundMessage {
  channel: string;
  senderId: string;
  chatId: string;
  content: string;
  rawEvent?: any;
  timestamp: Date;
  messageId?: string;
  media?: string[];       // 图片 URL，发送给 LLM
  files?: InboundFile[];  // 非图片文件，保存到本地
  sessionKey?: string;
  messageType?: 'private' | 'group';

  // 处理意图：描述插件如何处理消息以及 Agent 应该如何响应
  intent?: ProcessingIntent;

  metadata?: Record<string, any>;
}

export interface OutboundMessage {
  channel: string;
  chatId: string;
  content: string;
  reasoning_content?: string;
  replyTo?: string;
  media?: string[];
  metadata?: Record<string, any>;
  messageType?: 'private' | 'group';
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
      url: string;
      detail?: 'auto' | 'low' | 'high';
    };
  }>;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface LLMResponse {
  content: string | null | undefined;
  reasoning_content?: string;
  toolCalls: ToolCall[];
  finishReason: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface PluginErrorContext {
  type: 'message' | 'tool' | 'response' | 'agent';
  plugin?: string;
  data?: any;
}

export interface AgentRoleConfig {
  name: string;
  description?: string;
  systemPrompt: string;
  provider: string;
  model: string;
  allowedSkills: string[];
  allowedTools: string[];
}

export interface AgentsConfig {
  roles: Record<string, AgentRoleConfig>;
}

export interface Config {
  server: ServerConfig;
  agent: AgentConfig;
  agents?: AgentsConfig;
  channels: Record<string, any>;
  providers: Record<string, ProviderConfig>;
  mcp?: MCPServersConfig;
  plugins?: Record<string, any>;
  skills?: Record<string, { enabled: boolean }>;
  log?: LogConfig;
  metrics?: MetricsConfig;
  tools?: ToolsConfig;
}

export interface ToolsConfig {
  timeoutMs?: number;
}

export interface LogConfig {
  level?: 'debug' | 'info' | 'warn' | 'error';
}

export interface MetricsConfig {
  enabled?: boolean;           // 是否启用指标收集，默认 true
  maxMetrics?: number;         // 最大指标数量，默认 10000
}

export interface ServerConfig {
  host: string;
  apiPort: number;
  apiEnabled?: boolean;
  token?: string;
}

export interface AgentConfig {
  defaults: {
    model: string;
    provider: string;
    description?: string;

    // 视觉和推理配置
    vision?: boolean;           // 是否启用视觉能力
    reasoning?: boolean;        // 是否启用推理模式
    visionProvider?: string;    // 视觉模型提供商名称
    visionModel?: string;       // 视觉模型名称

    maxToolIterations: number;
    memoryWindow: number;
    memorySummary?: MemorySummaryConfig;
    memoryFacts?: MemoryFactsConfig;
    systemPrompt?: string;
    contextMode: 'session' | 'channel' | 'global';
    maxSessions?: number;
  };
}

export interface MemorySummaryConfig {
  enabled?: boolean;
  provider?: string;
  model?: string;
  triggerMessages?: number;
}

export interface MemoryFactsConfig {
  enabled?: boolean;
  provider?: string;
  model?: string;
  maxFacts?: number;
}

export interface ProviderConfig {
  apiKey?: string;
  apiBase?: string;
  model?: string;
  headers?: Record<string, string>;
  extraBody?: Record<string, any>;
}

export type MCPTransportType = 'local' | 'http';

export interface MCPServerConfig {
  type: MCPTransportType;
  command?: string[];
  url?: string;
  environment?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface MCPServersConfig {
  [name: string]: MCPServerConfig;
}

export type MCPServerStatus = 'connecting' | 'connected' | 'failed' | 'disconnected';

export interface MCPServerInfo {
  name: string;
  status: MCPServerStatus;
  config: MCPServerConfig;
  connectedAt?: Date;
  error?: string;
  toolCount: number;
}

/**
 * 视觉配置 - 用于 Agent 执行时的视觉模型路由
 */
export interface VisionSettings {
  enabled: boolean;
  reasoning: boolean;
  visionProviderName?: string;
  visionModelName?: string;
}
