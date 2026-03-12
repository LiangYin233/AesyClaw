import type {
  AgentConfig,
  AgentRoleConfig,
  AgentsConfig,
  Config,
  LogConfig,
  MCPServerConfig,
  MCPServersConfig,
  MCPTransportType,
  MemoryFactsConfig,
  MemorySummaryConfig,
  MetricsConfig,
  ProviderConfig,
  ServerConfig,
  StoredAgentRoleConfig,
  ToolsConfig
} from './config/schema.js';

export type {
  AgentConfig,
  AgentRoleConfig,
  AgentsConfig,
  Config,
  LogConfig,
  MCPServerConfig,
  MCPServersConfig,
  MCPTransportType,
  MemoryFactsConfig,
  MemorySummaryConfig,
  MetricsConfig,
  ProviderConfig,
  ServerConfig,
  StoredAgentRoleConfig,
  ToolsConfig
};

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
  files?: string[];
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
