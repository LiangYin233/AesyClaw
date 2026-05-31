/** 聊天相关类型定义 */

import type { DesktopUsage } from '../../preload/index';

export type ToolCallState = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  status: 'running' | 'done' | 'error';
  expanded: boolean;
};

export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  streaming: boolean;
  pendingToolCalls: Map<string, ToolCallState>;
  /** 当前正在累积的 assistant 文本消息 */
  activeAssistantMessage: AssistantMessage | null;
  /** 正在加载历史消息 */
  isLoading?: boolean;
};

export type ChatMessage =
  | UserMessage
  | AssistantMessage
  | ToolMessage
  | { role: 'system'; text: string };

export type UserMessage = {
  role: 'user';
  text: string;
  attachments?: ChatAttachment[];
};

export type ChatAttachment = {
  name: string;
  mime: string;
  size: number;
  path?: string;
};

export type MediaItem = {
  kind: string;
  base64?: string;
  mimeType?: string;
  name?: string;
  localPath?: string;
};

export type AssistantMessage = {
  role: 'assistant';
  text: string;
  streaming: boolean;
  isIntermediate?: boolean; // tool call 之间的片段文本，非最终回复
  usage?: DesktopUsage;
  media?: MediaItem[];
};

export type ToolMessage = {
  role: 'tool';
  toolCall: ToolCallState;
};
