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
  | {
      type: 'tool_result';
      sessionId: string;
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; sessionId: string; message: string };

type ChatControlMessage = { type: 'auth'; adminToken: string };

type ChatWsMessage = ChatMessage | ChatControlMessage;

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
  private adminToken: string | null = null;
  private status: ConnectionStatus = { chat: 'disconnected', admin: 'disconnected' };
  private adminRequests = new Map<string, (msg: AdminMessage) => void>();
  private reconnectEnabled = false;
  private generation = 0;
  private reconnectTimers = new Map<'chat' | 'admin', ReturnType<typeof setTimeout>>();

  constructor(chatUrl: string, adminUrl: string) {
    super();
    this.chatUrl = chatUrl;
    this.adminUrl = adminUrl;
  }

  updateUrls(chatUrl: string, adminUrl: string): void {
    this.chatUrl = chatUrl;
    this.adminUrl = adminUrl;
  }

  // ─── 连接管理 ──────────────────────────────────────────────────

  connect(): void {
    this.reconnectEnabled = true;
    this.connectChat();
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    this.generation++;
    this.clearReconnectTimers();
    this.rejectPendingAdminRequests('Admin WS 已断开');
    this.chatWs?.close();
    this.adminWs?.close();
    this.chatWs = null;
    this.adminWs = null;
    this.status = { chat: 'disconnected', admin: 'disconnected' };
    this.emit('status-change', this.getStatus());
  }

  getStatus(): ConnectionStatus {
    return { ...this.status };
  }

  // ─── 聊天消息 ──────────────────────────────────────────────────

  sendChatMessage(sessionId: string, text: string): boolean {
    if (this.chatWs?.readyState !== WebSocket.OPEN) return false;
    this.chatWs.send(JSON.stringify({ type: 'chat', sessionId, text }));
    return true;
  }

  sendCancelMessage(sessionId: string): void {
    if (this.chatWs?.readyState !== WebSocket.OPEN) return;
    this.chatWs.send(JSON.stringify({ type: 'cancel', sessionId }));
  }

  // ─── 管理请求 ──────────────────────────────────────────────────

  async sendAdminRequest(request: {
    type: string;
    requestId: string;
    payload?: unknown;
  }): Promise<AdminMessage> {
    return await new Promise((resolve) => {
      if (this.adminWs?.readyState !== WebSocket.OPEN) {
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

      this.adminWs.send(
        JSON.stringify({
          type: request.type,
          requestId: request.requestId,
          data: request.payload,
        }),
      );
    });
  }

  // ─── 私有方法 ──────────────────────────────────────────────────

  private isSocketActive(ws: WebSocket | null): boolean {
    return ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING;
  }

  private rejectPendingAdminRequests(error: string): void {
    for (const [requestId, resolve] of this.adminRequests) {
      this.adminRequests.delete(requestId);
      resolve({ type: 'admin', ok: false, error });
    }
  }

  private clearReconnectTimers(): void {
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
  }

  private connectChat(): void {
    if (this.isSocketActive(this.chatWs)) return;
    const generation = this.generation;
    this.status.chat = 'connecting';
    this.emit('status-change', this.getStatus());

    this.chatWs = new WebSocket(this.chatUrl);

    this.chatWs.on('open', () => {
      this.status.chat = 'connected';
      this.emit('status-change', this.getStatus());
    });

    this.chatWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ChatWsMessage;
        if (msg.type === 'auth') {
          this.adminToken = msg.adminToken;
          this.connectAdmin();
          return;
        }
        this.emit('chat-message', msg);
      } catch {
        // 忽略无效消息
      }
    });

    this.chatWs.on('close', () => {
      if (generation !== this.generation) return;
      this.chatWs = null;
      this.status.chat = 'disconnected';
      this.emit('status-change', this.getStatus());
      this.scheduleReconnect('chat', generation);
    });

    this.chatWs.on('error', () => {
      // 由 close 事件处理重连
    });
  }

  private connectAdmin(): void {
    if (this.isSocketActive(this.adminWs)) return;
    const generation = this.generation;
    const adminUrl = this.resolveAdminUrl();
    if (!adminUrl) return;

    this.status.admin = 'connecting';
    this.emit('status-change', this.getStatus());

    this.adminWs = new WebSocket(adminUrl);

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
      if (generation !== this.generation) return;
      this.adminWs = null;
      this.status.admin = 'disconnected';
      this.emit('status-change', this.getStatus());
      this.scheduleReconnect('admin', generation);
    });

    this.adminWs.on('error', () => {
      // 由 close 事件处理重连
    });
  }

  private resolveAdminUrl(): string | null {
    if (!this.adminToken) return null;

    const url = new URL(this.adminUrl);
    url.searchParams.set('token', this.adminToken);
    return url.toString();
  }

  private scheduleReconnect(target: 'chat' | 'admin', generation: number): void {
    if (!this.reconnectEnabled || generation !== this.generation) return;
    const existing = this.reconnectTimers.get(target);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(target);
      if (!this.reconnectEnabled || generation !== this.generation) return;
      if (target === 'chat') {
        this.connectChat();
      } else {
        this.connectAdmin();
      }
    }, RECONNECT_DELAY_MS);
    this.reconnectTimers.set(target, timer);
  }
}
