/**
 * WebSocket 客户端 composable — 单例连接管理、消息收发、自动重连、心跳。
 *
 * 用法：
 * ```ts
 * const ws = useWebSocket();
 * ws.connect(token);
 * const result = await ws.send('get_status');
 * ```
 */

import { ref } from 'vue';

type MessageHandler = (data: unknown) => void;

export type WsResponse = {
  type: string;
  requestId?: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

class WebSocketClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private requestSeq = 0;

  /** 连接状态 */
  readonly connected = ref<boolean>(false);

  /** 消息处理器映射：type -> handler[] */
  private handlers = new Map<string, Set<MessageHandler>>();

  /** 待处理的请求：requestId -> { resolve, reject, timer } */
  private pending = new Map<
    string,
    {
      resolve: (data: unknown) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  /**
   * 建立 WebSocket 连接。
   * 如果已有连接则先关闭。
   */
  connect(token: string): void {
    if (
      this.token === token &&
      (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING)
    ) {
      return; // 已连接或正在连接且 token 相同
    }

    this.token = token;
    this.destroyed = false;
    this.reconnectAttempt = 0;
    this.disconnectInternal();
    this.doConnect();
  }

  /**
   * 发送消息并等待响应。
   * 返回 Promise，在收到匹配 type 的响应时 resolve，超时时 reject。
   */
  send(type: string, data?: unknown, timeoutMs = 15_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = this.nextRequestId();
      let cancelled = false;
      const timer = setTimeout(() => {
        cancelled = true;
        this.pending.delete(requestId);
        reject(new Error(`请求超时: ${type}`));
      }, timeoutMs);

      const trySend = () => {
        if (cancelled) return;
        if (
          !this.ws ||
          this.ws.readyState === WebSocket.CLOSED ||
          this.ws.readyState === WebSocket.CLOSING
        ) {
          clearTimeout(timer);
          reject(new Error('WebSocket 未连接'));
          return;
        }
        if (this.ws.readyState === WebSocket.CONNECTING) {
          setTimeout(trySend, 50);
          return;
        }
        // OPEN
        this.pending.set(requestId, { resolve, reject, timer });
        this.ws.send(JSON.stringify({ type, requestId, data }));
      };
      trySend();
    });
  }

  /**
   * 注册消息监听器。
   */
  on(type: string, handler: MessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.add(handler);
    }
  }

  /**
   * 移除消息监听器。
   */
  off(type: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(type);
      }
    }
  }

  /**
   * 断开连接并清理所有状态。
   */
  disconnect(): void {
    this.destroyed = true;
    this.token = null;
    this.reconnectAttempt = 0;
    this.disconnectInternal();
    this.rejectAllPending(new Error('WebSocket 已断开'));
  }

  private disconnectInternal(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer !== null) {
      clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws !== null) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    this.connected.value = false;
  }

  private doConnect(): void {
    if (this.destroyed || this.token === null) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/api/ws?token=${encodeURIComponent(this.token)}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected.value = true;
      this.reconnectAttempt = 0;
      this.startPingMonitor();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const response = JSON.parse(event.data as string) as WsResponse;

        // 收到任何有效消息都证明连接存活，重置心跳监控
        this.stopPingMonitor();
        this.startPingMonitor();

        // 处理 JSON 级心跳 ping/pong
        if (response.type === 'ping') {
          if (this.ws !== null) {
            this.ws.send(JSON.stringify({ type: 'pong' }));
          }
          return;
        }

        // 处理待处理请求的响应
        const pending = response.requestId ? this.pending.get(response.requestId) : undefined;
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          this.pending.delete(response.requestId as string);
          if (response.ok) {
            pending.resolve(response.data);
          } else {
            pending.reject(new Error(response.error ?? '请求失败'));
          }
          return;
        }

        // 分发到注册的监听器
        const handlers = this.handlers.get(response.type);
        if (handlers !== undefined) {
          for (const handler of handlers) {
            handler(response.data ?? response);
          }
        }
      } catch {
        // 忽略无法解析的消息
      }
    };

    this.ws.onclose = () => {
      this.connected.value = false;
      this.stopPingMonitor();
      if (!this.destroyed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose 会随后触发，由 onclose 处理重连
    };
  }

  private startPingMonitor(): void {
    this.pingTimer = setTimeout(() => {
      // ping 超时，强制断开触发重连
      if (this.ws !== null) {
        this.ws.close();
      }
    }, 45_000); // 略大于 30s 心跳间隔 + 网络延迟余量
  }

  private stopPingMonitor(): void {
    if (this.pingTimer !== null) {
      clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;

    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30_000);
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.doConnect();
    }, delay);
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private nextRequestId(): string {
    this.requestSeq += 1;
    return `req-${Date.now()}-${this.requestSeq}`;
  }
}

// 全局单例
let client: WebSocketClient | null = null;

function getClient(): WebSocketClient {
  client ??= new WebSocketClient();
  return client;
}

/**
 * 使用全局 WebSocket 连接。
 * 返回单例的 WebSocket 客户端实例。
 *
 * 在所有组件中共享同一个连接。
 */
export function useWebSocket() {
  return getClient();
}
