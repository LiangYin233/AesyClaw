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
  messageType?: 'private' | 'group' | 'discuss';
  replyOnly?: boolean;
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

export type EventType = 'message' | 'tool_call' | 'heartbeat';

export interface Event {
  type: EventType;
  data: InboundMessage | OutboundMessage;
  timestamp: Date;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
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
  content: string | null;
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
  log?: LogConfig;
}

export interface LogConfig {
  level?: 'debug' | 'info' | 'warn' | 'error';
  showTimestamp?: boolean;
  useColors?: boolean;
}

export interface ServerConfig {
  host: string;
  port: number;
  apiPort: number;
  webuiPort?: number;
}

export interface AgentConfig {
  defaults: {
    model: string;
    provider: string;
    maxTokens: number;
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

export interface MCPServersConfig {
  [name: string]: {
    command?: string;
    args?: string[];
    url?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
  };
}
