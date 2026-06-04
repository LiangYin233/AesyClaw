/** WebSocket 连接管理器。
 *
 * 管理到 AesyClaw Desktop channel 的 WebSocket 连接。
 *
 * 支持自动重连、心跳、事件分发。
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

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

export type ChatMessage =
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
  | { type: 'sessions'; requestId?: string; data: unknown }
  | { type: 'session_messages'; requestId?: string; sessionId: string; data: unknown };
type ChatControlMessage = {
  type: 'auth';
  commands?: Array<{ name: string; description: string }>;
};

type ChannelResponseMessage = {
  type: 'config_response';
  requestId?: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

type ChatWsMessage = ChatMessage | ChatControlMessage | ChannelResponseMessage;

export type ChannelResponse = {
  type: string;
  requestId?: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type ConnectionStatus = {
  chat: 'connected' | 'connecting' | 'disconnected';
};

export type DesktopUploadFile = {
  name: string;
  mime: string;
  size: number;
  data: ArrayBuffer | Uint8Array | Buffer;
};

const RECONNECT_DELAY_MS = 3000;

export class WebSocketManager extends EventEmitter {
  private chatWs: WebSocket | null = null;
  private chatUrl: string;
  private _commands: Array<{ name: string; description: string }> = [];
  private status: ConnectionStatus = { chat: 'disconnected' };
  private channelRequests = new Map<string, (msg: ChannelResponse) => void>();
  private reconnectEnabled = false;
  private generation = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(chatUrl: string) {
    super();
    this.chatUrl = chatUrl;
  }

  updateUrl(chatUrl: string): void {
    this.chatUrl = chatUrl;
  }

  // ─── 连接管理 ──────────────────────────────────────────────────

  connect(): void {
    this.reconnectEnabled = true;
    this.connectChat();
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    this.generation++;
    this.clearReconnectTimer();
    this.rejectPendingChannelRequests('Channel WS 已断开');
    this.chatWs?.close();
    this.chatWs = null;
    this.status = { chat: 'disconnected' };
    this.emit('status-change', this.getStatus());
  }

  getStatus(): ConnectionStatus {
    return { ...this.status };
  }

  getCommands(): Array<{ name: string; description: string }> {
    return [...this._commands];
  }

  // ─── 聊天消息 ──────────────────────────────────────────────────

  async sendChatMessage(
    sessionId: string,
    text: string,
    files: DesktopUploadFile[] = [],
  ): Promise<boolean> {
    if (this.chatWs?.readyState !== WebSocket.OPEN) return false;

    const fileMetas = files.map((file) => ({
      fileId: randomUUID(),
      name: file.name,
      mime: file.mime || 'application/octet-stream',
      size: file.size,
    }));

    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const meta = fileMetas[index];
      if (!file || !meta) continue;
      this.sendFile(sessionId, meta.fileId, file);
    }

    this.chatWs.send(JSON.stringify({ type: 'chat', sessionId, text, files: fileMetas }));
    return true;
  }

  private sendFile(sessionId: string, fileId: string, file: DesktopUploadFile): void {
    if (this.chatWs?.readyState !== WebSocket.OPEN) return;

    const data = Buffer.isBuffer(file.data)
      ? file.data
      : Buffer.from(file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data));
    const chunkSize = 256 * 1024;
    const totalChunks = Math.max(1, Math.ceil(data.length / chunkSize));

    this.chatWs.send(
      JSON.stringify({
        type: 'file_start',
        sessionId,
        fileId,
        name: file.name,
        mime: file.mime || 'application/octet-stream',
        totalSize: data.length,
        totalChunks,
      }),
    );

    for (let offset = 0; offset < data.length; offset += chunkSize) {
      this.chatWs.send(data.subarray(offset, offset + chunkSize));
    }

    if (data.length === 0) {
      this.chatWs.send(Buffer.alloc(0));
    }

    this.chatWs.send(JSON.stringify({ type: 'file_end', sessionId, fileId }));
  }

  sendCancelMessage(sessionId: string): void {
    if (this.chatWs?.readyState !== WebSocket.OPEN) return;
    this.chatWs.send(JSON.stringify({ type: 'cancel', sessionId }));
  }

  /** 发送任意 JSON 消息到 chat WebSocket */
  sendRawMessage(type: string, payload: Record<string, unknown> = {}): boolean {
    if (this.chatWs?.readyState !== WebSocket.OPEN) return false;
    this.chatWs.send(JSON.stringify({ type, ...payload }));
    return true;
  }

  // ─── 管理请求 ──────────────────────────────────────────────────

  async sendChannelRequest(request: {
    type: string;
    requestId: string;
    payload?: unknown;
  }): Promise<ChannelResponse> {
    return await new Promise((resolve) => {
      if (this.chatWs?.readyState !== WebSocket.OPEN) {
        resolve({ type: request.type, ok: false, error: 'Channel WS 未连接' });
        return;
      }

      const timeout = setTimeout(() => {
        this.channelRequests.delete(request.requestId);
        resolve({ type: request.type, ok: false, error: '请求超时' });
      }, 10000);

      this.channelRequests.set(request.requestId, (msg) => {
        clearTimeout(timeout);
        resolve({ ...msg, type: request.type });
      });
      this.chatWs.send(
        JSON.stringify({
          type: 'config_request',
          requestId: request.requestId,
          action: request.type,
          data: request.payload,
        }),
      );
    });
  }

  // ─── 私有方法 ──────────────────────────────────────────────────

  private isSocketActive(ws: WebSocket | null): boolean {
    return ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING;
  }

  private rejectPendingChannelRequests(error: string): void {
    for (const [requestId, resolve] of this.channelRequests) {
      this.channelRequests.delete(requestId);
      resolve({ type: 'channel', ok: false, error });
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
          this._commands = msg.commands ?? [];
          this.emit('chat-commands', this._commands);
          return;
        }
        if (msg.type === 'config_response') {
          const pending = msg.requestId ? this.channelRequests.get(msg.requestId) : undefined;
          if (pending && msg.requestId) {
            this.channelRequests.delete(msg.requestId);
            pending(msg as ChannelResponse);
          }
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
      this.rejectPendingChannelRequests('Channel WS 已断开');
      this.emit('status-change', this.getStatus());
      this.scheduleReconnect(generation);
    });

    this.chatWs.on('error', () => {
      // 由 close 事件处理重连
    });
  }

  private scheduleReconnect(generation: number): void {
    if (!this.reconnectEnabled || generation !== this.generation) return;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.reconnectEnabled || generation !== this.generation) return;
      this.connectChat();
    }, RECONNECT_DELAY_MS);
  }
}
