/** channel_desktop 协议类型定义。
 *
 * 定义 Electron 客户端与 channel_desktop 插件之间的 WebSocket 消息格式。
 */

import type { Message, MessageUsage, SessionKey } from '@aesyclaw/sdk';

// ─── 上行消息（Electron → AesyClaw）───────────────────────────────

export type DesktopInboundMessage =
  | DesktopChatMessage
  | DesktopCancelMessage
  | DesktopFileStartMessage
  | DesktopFileEndMessage
  | DesktopPongMessage
  | DesktopGetContextUsageMessage
  | DesktopConfigRequestMessage
  | { type: 'get_sessions'; requestId?: string }
  | { type: 'get_session_messages'; requestId?: string; sessionId: string };

/** 用户发送的聊天消息 */
export type DesktopChatMessage = {
  type: 'chat';
  sessionId: string;
  text: string;
  /** 附加的文件元数据，实际数据通过二进制帧发送 */
  files?: DesktopFileMeta[];
};

/** 取消当前 Agent 执行 */
export type DesktopCancelMessage = {
  type: 'cancel';
  sessionId: string;
};

/** 文件传输开始（元数据帧） */
export type DesktopFileStartMessage = {
  type: 'file_start';
  sessionId: string;
  fileId: string;
  name: string;
  mime: string;
  totalSize: number;
  totalChunks: number;
};

/** 文件传输结束 */
export type DesktopFileEndMessage = {
  type: 'file_end';
  sessionId: string;
  fileId: string;
};

/** 心跳回复 */
export type DesktopPongMessage = {
  type: 'pong';
};

/** 查询会话上下文窗口使用率 */
export type DesktopGetContextUsageMessage = {
  type: 'get_context_usage';
  sessionId: string;
};

/** 上下文窗口使用率响应 */
export type DesktopContextUsageMessage = {
  type: 'context_usage';
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  contextWindow: number;
  modelId?: string;
  roleId?: string;
};

export type DesktopConfigRequestMessage = {
  type: 'config_request';
  requestId: string;
  action: 'get_config' | 'update_config' | 'set_channel_enabled' | 'set_plugin_enabled';
  data?: unknown;
};

export type DesktopConfigResponseMessage = {
  type: 'config_response';
  requestId: string;
  action: DesktopConfigRequestMessage['action'];
  ok: boolean;
  data?: unknown;
  error?: string;
};

// ─── 下行消息（AesyClaw → Electron）───────────────────────────────

export type DesktopOutboundMessage =
  | DesktopChunkMessage
  | DesktopMediaMessage
  | DesktopToolCallMessage
  | DesktopToolResultMessage
  | DesktopDoneMessage
  | DesktopErrorMessage
  | DesktopAuthMessage
  | DesktopFileStartMessage
  | DesktopFileEndMessage
  | DesktopPingMessage
  | DesktopContextUsageMessage
  | DesktopConfigResponseMessage
  | { type: 'sessions'; requestId?: string; data: unknown }
  | { type: 'session_messages'; requestId?: string; sessionId: string; data: unknown };

/** 流式文本块 */
export type DesktopChunkMessage = {
  type: 'chunk';
  sessionId: string;
  text: string;
  index: number;
};

/** 助理消息（含文本 + 媒体附件） */
export type DesktopMediaMessage = {
  type: 'media';
  sessionId: string;
  text: string;
  items: DesktopMediaItem[];
};

export type DesktopMediaItem = {
  kind: 'image' | 'audio' | 'video' | 'file';
  base64?: string;
  mimeType?: string;
  name?: string;
};

/** 工具调用开始 */
export type DesktopToolCallMessage = {
  type: 'tool_call';
  sessionId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
};

/** 工具调用结果 */
export type DesktopToolResultMessage = {
  type: 'tool_result';
  sessionId: string;
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
};

/** Agent 本轮处理完成 */
export type DesktopDoneMessage = {
  type: 'done';
  sessionId: string;
  usage?: MessageUsage;
};

/** 错误 */
export type DesktopErrorMessage = {
  type: 'error';
  sessionId: string;
  message: string;
};

/** Desktop 连接成功后的运行时信息 */
export type DesktopAuthMessage = {
  type: 'auth';
  /** 可用命令列表，供客户端实现命令补全 */
  commands?: Array<{ name: string; description: string }>;
};

/** 心跳请求 */
export type DesktopPingMessage = {
  type: 'ping';
};

// ─── 文件元数据 ────────────────────────────────────────────────────

export type DesktopFileMeta = {
  fileId?: string;
  name: string;
  mime: string;
  size: number;
};

// ─── 内部类型 ──────────────────────────────────────────────────────

/** 文件传输缓冲区状态 */
export type DesktopFileBuffer = {
  fileId: string;
  sessionId: string;
  name: string;
  mime: string;
  totalChunks: number;
  chunks: Buffer[];
  received: number;
};

/** 已接收并落盘的文件 */
export type DesktopReceivedFile = {
  fileId: string;
  sessionId: string;
  name: string;
  mime: string;
  size: number;
  filePath: string;
};

/** 解析后的入站消息（带 sessionKey） */
export type DesktopParsedMessage = {
  sessionKey: SessionKey;
  message: Message;
  sender: { id: string; name?: string };
};
