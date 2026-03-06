export interface InboundMessage {
  channel: string;
  senderId: string;
  chatId: string;
  content: string;
  rawEvent?: any;
  timestamp: Date;
  messageId?: string;
  media?: string[];
  sessionKey?: string;
  messageType?: 'private' | 'group';
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

export interface Config {
  server: ServerConfig;
  agent: AgentConfig;
  channels: Record<string, any>;
  providers: Record<string, ProviderConfig>;
  mcp?: MCPServersConfig;
  plugins?: Record<string, any>;
  skills?: Record<string, { enabled: boolean }>;
  log?: LogConfig;
  metrics?: MetricsConfig;
}

export interface LogConfig {
  level?: 'debug' | 'info' | 'warn' | 'error';
}

export interface MetricsConfig {
  enabled?: boolean;           // 是否启用指标收集，默认 true
  maxMetrics?: number;         // 最大指标数量，默认 10000
  collectAgent?: boolean;      // 收集 Agent 指标，默认 true
  collectTools?: boolean;      // 收集工具指标，默认 true
  collectPlugins?: boolean;    // 收集插件指标，默认 true
}

export interface ServerConfig {
  host: string;
  port: number;
  apiPort: number;
  apiEnabled?: boolean;
}

export interface AgentConfig {
  defaults: {
    model: string;
    provider: string;

    maxToolIterations: number;
    memoryWindow: number;
    systemPrompt?: string;
    contextMode: 'session' | 'channel' | 'global';
    maxSessions?: number;
  };
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
