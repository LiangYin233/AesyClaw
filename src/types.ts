﻿import type {
  AgentConfig,
  AgentRoleConfig,
  AgentsConfig,
  Config,
  MCPServerConfig,
  MCPServersConfig,
  MCPTransportType,
  MemoryFactsConfig,
  MemorySummaryConfig,
  LoggingConfig,
  ObservabilityConfig,
  ProviderConfig,
  ServerConfig,
  ToolsConfig,
} from './features/config/schema/index.js';
import type {
  UnifiedMessage,
  ImageAttachment,
  FileAttachment
} from './features/extension/channel/index.js';

export type {
  AgentConfig,
  AgentRoleConfig,
  AgentsConfig,
  Config,
  LoggingConfig,
  MCPServerConfig,
  MCPServersConfig,
  MCPTransportType,
  MemoryFactsConfig,
  MemorySummaryConfig,
  ObservabilityConfig,
  ProviderConfig,
  ServerConfig,
  ToolsConfig
};

export type {
  UnifiedMessage,
  ImageAttachment,
  FileAttachment
};

export interface InboundFile {
  name: string;
  url: string;
  localPath?: string; // Channel 下载后的本地路径。
  type?: 'audio' | 'video' | 'file' | 'image'; // 文件类型，供插件识别。
}

/**
 * 插件处理意图。
 * 用于描述插件已处理到哪一步，以及 Agent 后续应如何接管。
 */
export type ProcessingIntent =
  | { type: 'continue' } // 继续交给 LLM 处理。
  | { type: 'reply', reason: string } // 直接回复，跳过 LLM。
  | { type: 'handled', reason: string } // 插件已完整处理当前消息。
  | { type: 'status', reason: string } // 输出状态提示。
  | { type: 'error', reason: string }; // 输出错误提示。

export interface InboundMessage {
  id?: string;
  channel: string;
  senderId: string;
  chatId: string;
  content: string;
  rawEvent?: any;
  timestamp: Date;
  messageId?: string;
  media?: string[]; // 图片 URL，会传给 LLM。
  files?: InboundFile[]; // 非图片文件，按本地文件处理。
  sessionKey?: string;
  messageType?: 'private' | 'group';

  // 标记插件处理结果，供 Agent 决定后续执行路径。
  intent?: ProcessingIntent;

  metadata?: Record<string, any>;
}

export interface OutboundMessage {
  id?: string;
  channel: string;
  chatId: string;
  content: string;
  reasoning_content?: string;
  replyTo?: string;
  media?: string[];
  files?: string[];
  metadata?: Record<string, any>;
  messageType?: 'private' | 'group';
  idempotencyKey?: string;
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
 * 视觉模型配置。
 * 用于决定是否直连视觉模型，以及摘要回退时走哪个模型。
 */
export interface VisionSettings {
  enabled: boolean;
  directVision: boolean;
  reasoning: boolean;
  fallbackModelRef?: string;
  fallbackProviderName?: string;
  fallbackModelName?: string;
}
