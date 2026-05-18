/** Preload 脚本 — 通过 contextBridge 暴露安全 API 给渲染进程。 */

import { contextBridge, ipcRenderer } from 'electron';

export type ChatMessageEvent =
  | { type: 'chunk'; sessionId: string; text: string; index: number }
  | { type: 'tool_call'; sessionId: string; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_result'; sessionId: string; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; sessionId: string; message: string };

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

const api = {
  /** 发送聊天消息 */
  sendChat: (sessionId: string, text: string) =>
    ipcRenderer.invoke('chat:send', { sessionId, text }) as Promise<boolean>,

  /** 取消当前对话 */
  cancelChat: (sessionId: string) =>
    ipcRenderer.invoke('chat:cancel', sessionId),

  /** 发送管理面板请求 */
  adminRequest: (type: string, payload?: unknown) => {
    const requestId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return ipcRenderer.invoke('admin:request', { type, requestId, payload }) as Promise<AdminMessageEvent>;
  },

  /** 获取连接状态 */
  getStatus: () =>
    ipcRenderer.invoke('status:get') as Promise<ConnectionStatus>,

  /** 监听聊天消息 */
  onChatMessage: (callback: (msg: ChatMessageEvent) => void): (() => void) => {
    const handler = (_event: unknown, msg: ChatMessageEvent): void => { callback(msg); };
    ipcRenderer.on('chat:message', handler);
    return () => { ipcRenderer.removeListener('chat:message', handler); };
  },

  /** 监听管理消息 */
  onAdminMessage: (callback: (msg: AdminMessageEvent) => void): (() => void) => {
    const handler = (_event: unknown, msg: AdminMessageEvent): void => { callback(msg); };
    ipcRenderer.on('admin:message', handler);
    return () => { ipcRenderer.removeListener('admin:message', handler); };
  },

  /** 监听连接状态变化 */
  onStatusChange: (callback: (status: ConnectionStatus) => void): (() => void) => {
    const handler = (_event: unknown, status: ConnectionStatus): void => { callback(status); };
    ipcRenderer.on('status:change', handler);
    return () => { ipcRenderer.removeListener('status:change', handler); };
  },

  // ── 窗口控制 ──────────────────────────────────────────────

  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>,
  onMaximizeChange: (callback: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: unknown, maximized: boolean): void => { callback(maximized); };
    ipcRenderer.on('window:maximizeChange', handler);
    return () => ipcRenderer.removeListener('window:maximizeChange', handler);
  },
};

contextBridge.exposeInMainWorld('aesyclaw', api);

export type AesyClawApi = typeof api;
