/** Preload 脚本 — 通过 contextBridge 暴露安全 API 给渲染进程。 */

import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopConnectionConfig } from '../shared/connection';
import { toIpcCloneable } from '../shared/ipc-clone';

export type DesktopUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

export type ChatMessageEvent =
  | { type: 'chunk'; sessionId: string; text: string; index: number }
  | {
      type: 'media';
      sessionId: string;
      text: string;
      items: Array<{ kind: string; base64?: string; mimeType?: string; name?: string }>;
    }
  | { type: 'tool_call'; sessionId: string; toolCallId: string; toolName: string; args: unknown }
  | {
      type: 'tool_result';
      sessionId: string;
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | { type: 'done'; sessionId: string; usage?: DesktopUsage }
  | { type: 'error'; sessionId: string; message: string }
  | {
      type: 'context_usage';
      sessionId: string;
      estimatedTokens: number;
      contextWindow: number;
      percentage: number;
    };
export type DesktopSessionSummary = {
  id: string;
  channel: string;
  type: string;
  chatId: string;
  title?: string;
  firstUserMessage?: string;
  messageCount?: number;
  lastActivity?: string;
};

export type DesktopHistoryMessage = {
  role: 'user' | 'assistant' | 'toolResult';
  content: string;
  timestamp?: string;
  usage?: DesktopUsage;
  toolCalls?: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>;
  toolResult?: { toolCallId: string; toolName: string; isError: boolean; details?: unknown };
  /** 兼容旧协议 */
  toolData?: string;
};

export type DesktopUploadFile = {
  name: string;
  mime: string;
  size: number;
  data: ArrayBuffer;
};

export type AdminMessageEvent = {
  type: string;
  requestId?: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type ConnectionStatus = {
  chat: 'connected' | 'connecting' | 'disconnected';
  admin: 'connected' | 'connecting' | 'disconnected';
};

export type DesktopCommand = {
  name: string;
  description: string;
};

export type { DesktopConnectionConfig };

const api = {
  /** 发送聊天消息 */
  sendChat: (sessionId: string, text: string, files: DesktopUploadFile[] = []) =>
    ipcRenderer.invoke('chat:send', { sessionId, text, files }) as Promise<boolean>,

  /** 取消当前对话 */
  cancelChat: (sessionId: string) => ipcRenderer.invoke('chat:cancel', sessionId),
  /** 发送任意 JSON 消息到 chat WebSocket */
  sendChatRaw: (type: string, sessionId: string) =>
    ipcRenderer.invoke('chat:sendRaw', { type, sessionId }),

  /** 发送管理面板请求 */
  adminRequest: (type: string, payload?: unknown) => {
    const requestId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return ipcRenderer.invoke('admin:request', {
      type,
      requestId,
      payload: toIpcCloneable(payload),
    }) as Promise<AdminMessageEvent>;
  },

  /** 获取连接状态 */
  getStatus: () => ipcRenderer.invoke('status:get') as Promise<ConnectionStatus>,

  /** 获取当前缓存的 Desktop 命令列表 */
  getCommands: () => ipcRenderer.invoke('commands:get') as Promise<DesktopCommand[]>,

  /** 获取 Desktop 连接配置 */
  getConnectionConfig: () =>
    ipcRenderer.invoke('connection:getConfig') as Promise<DesktopConnectionConfig>,

  /** 更新 Desktop 连接配置并重连 */
  updateConnectionConfig: (config: DesktopConnectionConfig) =>
    ipcRenderer.invoke(
      'connection:updateConfig',
      toIpcCloneable(config),
    ) as Promise<DesktopConnectionConfig>,

  /** 监听聊天消息 */
  onChatMessage: (callback: (msg: ChatMessageEvent) => void): (() => void) => {
    const handler = (_event: unknown, msg: ChatMessageEvent): void => {
      callback(msg);
    };
    ipcRenderer.on('chat:message', handler);
    return () => {
      ipcRenderer.removeListener('chat:message', handler);
    };
  },

  /** 监听管理消息 */
  onAdminMessage: (callback: (msg: AdminMessageEvent) => void): (() => void) => {
    const handler = (_event: unknown, msg: AdminMessageEvent): void => {
      callback(msg);
    };
    ipcRenderer.on('admin:message', handler);
    return () => {
      ipcRenderer.removeListener('admin:message', handler);
    };
  },
  /** 监听桌面频道下发的可用命令列表 */
  onCommands: (callback: (commands: DesktopCommand[]) => void): (() => void) => {
    const handler = (_event: unknown, commands: DesktopCommand[]): void => {
      callback(commands);
    };
    ipcRenderer.on('chat:commands', handler);
    return () => {
      ipcRenderer.removeListener('chat:commands', handler);
    };
  },

  /** 监听连接状态变化 */
  onStatusChange: (callback: (status: ConnectionStatus) => void): (() => void) => {
    const handler = (_event: unknown, status: ConnectionStatus): void => {
      callback(status);
    };
    ipcRenderer.on('status:change', handler);
    return () => {
      ipcRenderer.removeListener('status:change', handler);
    };
  },

  // ── 窗口控制 ──────────────────────────────────────────────

  minimizeWindow: () => ipcRenderer.invoke('win-action', 'minimize'),
  maximizeWindow: () => ipcRenderer.invoke('win-action', 'maximize'),
  closeWindow: () => ipcRenderer.invoke('win-action', 'close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>,
  onMaximizeChange: (callback: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: unknown, maximized: boolean): void => {
      callback(maximized);
    };
    ipcRenderer.on('window:maximizeChange', handler);
    return () => ipcRenderer.removeListener('window:maximizeChange', handler);
  },
  /** 保存 base64 文件到临时目录，返回本地路径 */
  saveFile: (name: string, data: string) =>
    ipcRenderer.invoke('file:saveTemp', { name, data }) as Promise<string>,
  /** 打开文件所在文件夹 */
  openFolder: (filePath: string) => ipcRenderer.invoke('file:openFolder', filePath),
};
contextBridge.exposeInMainWorld('aesyclaw', api);

export type AesyClawApi = typeof api;
