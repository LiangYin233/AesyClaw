/** WebSocket 连接管理器。
 *
 * 管理到 AesyClaw 的双 WebSocket 连接：
 * - chatWs：聊天消息流（channel_desktop 插件端口 9730）
 * - adminWs：管理面板（Hono 服务端口 3000 /api/ws）
 *
 * 支持自动重连、心跳、事件分发。
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';

export type ChatMessage =
  | { type: 'chunk'; sessionId: string; text: string; index: number }
  | { type: 'tool_call'; sessionId: string; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_result'; sessionId: string; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; sessionId: string; message: string };

export type AdminMessage = {
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

const RECONNECT_DELAY_MS = 3000;

export class WebSocketManager extends EventEmitter {
  private chatWs: WebSocket | null = null;
  private adminWs: WebSocket | null = null;
  private chatUrl: string;
  private adminUrl: string;
  private status: ConnectionStatus = { chat: 'disconnected', admin: 'disconnected' };
  private adminRequests = new Map<string, (msg: AdminMessage) => void>();
  private requestIdCounter = 0;

  constructor(chatUrl: string, adminUrl: string) {
    super();
    this.chatUrl = chatUrl;
    this.adminUrl = adminUrl;
  }

  // ─── 连接管理 ──────────────────────────────────────────────────

  connect(): void {
    this.connectChat();
    this.connectAdmin();
  }

  disconnect(): void {
    this.chatWs?.close();
    this.adminWs?.close();
  }

  getStatus(): ConnectionStatus {
    return { ...this.status };
  }

  // ─── 聊天消息 ──────────────────────────────────────────────────

  sendChatMessage(sessionId: string, text: string): boolean {
    if (!this.chatWs || this.chatWs.readyState !== WebSocket.OPEN) return false;
    this.chatWs.send(JSON.stringify({ type: 'chat', sessionId, text }));
    return true;
  }

  sendCancelMessage(sessionId: string): void {
    if (!this.chatWs || this.chatWs.readyState !== WebSocket.OPEN) return;
    this.chatWs.send(JSON.stringify({ type: 'cancel', sessionId }));
  }

  // ─── 管理请求 ──────────────────────────────────────────────────

  async sendAdminRequest(request: { type: string; requestId: string; payload?: unknown }): Promise<AdminMessage> {
    return new Promise((resolve) => {
      if (!this.adminWs || this.adminWs.readyState !== WebSocket.OPEN) {
        resolve({ type: request.type, ok: false, error: 'Admin WS 未连接' });
        return;
      }

      this.adminRequests.set(request.requestId, resolve);

      const timeout = setTimeout(() => {
        this.adminRequests.delete(request.requestId);
        resolve({ type: request.type, ok: false, error: '请求超时' });
      }, 10000);

      // 包装 resolve 以清除超时
      const originalResolve = resolve;
      this.adminRequests.set(request.requestId, (msg) => {
        clearTimeout(timeout);
        originalResolve(msg);
      });

      this.adminWs.send(JSON.stringify({
        type: request.type,
        requestId: request.requestId,
        payload: request.payload,
      }));
    });
  }

  // ─── 私有方法 ──────────────────────────────────────────────────

  private connectChat(): void {
    this.status.chat = 'connecting';
    this.emit('status-change', this.getStatus());

    this.chatWs = new WebSocket(this.chatUrl);

    this.chatWs.on('open', () => {
      this.status.chat = 'connected';
      this.emit('status-change', this.getStatus());
    });

    this.chatWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ChatMessage;
        this.emit('chat-message', msg);
      } catch {
        // 忽略无效消息
      }
    });

    this.chatWs.on('close', () => {
      this.status.chat = 'disconnected';
      this.emit('status-change', this.getStatus());
      this.scheduleReconnect('chat');
    });

    this.chatWs.on('error', () => {
      // 由 close 事件处理重连
    });
  }

  private connectAdmin(): void {
    this.status.admin = 'connecting';
    this.emit('status-change', this.getStatus());

    this.adminWs = new WebSocket(this.adminUrl);

    this.adminWs.on('open', () => {
      this.status.admin = 'connected';
      this.emit('status-change', this.getStatus());
    });

    this.adminWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as AdminMessage;
        if (msg.type === 'pong') return;

        // 匹配请求
        if (msg.requestId) {
          const pending = this.adminRequests.get(msg.requestId);
          if (pending) {
            this.adminRequests.delete(msg.requestId);
            pending(msg);
            return;
          }
        }

        this.emit('admin-message', msg);
      } catch {
        // 忽略无效消息
      }
    });

    this.adminWs.on('close', () => {
      this.status.admin = 'disconnected';
      this.emit('status-change', this.getStatus());
      this.scheduleReconnect('admin');
    });

    this.adminWs.on('error', () => {
      // 由 close 事件处理重连
    });
  }

  private scheduleReconnect(target: 'chat' | 'admin'): void {
    setTimeout(() => {
      if (target === 'chat') {
        this.connectChat();
      } else {
        this.connectAdmin();
      }
    }, RECONNECT_DELAY_MS);
  }
}
