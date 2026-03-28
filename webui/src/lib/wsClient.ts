const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_RPC_TIMEOUT_MS = 5 * 60_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

interface WsErrorPayload {
  code?: string;
  message?: string;
  details?: unknown;
}

interface WsResponseMessage {
  id: string | number | null;
  ok: boolean;
  result?: unknown;
  error?: WsErrorPayload;
}

interface WsEventMessage {
  type: 'event';
  subscriptionId: string;
  topic: string;
  data: unknown;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId: number;
};

type SubscriptionHandler<T> = (data: T) => void;

interface LocalSubscription<T = unknown> {
  localId: string;
  topic: string;
  params?: unknown;
  handler: SubscriptionHandler<T>;
  onError?: (message: string) => void;
  serverSubscriptionId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : '请求失败';
}

function resolveWebSocketUrl(token: string): string {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL;
  const baseUrl = new URL(configuredBaseUrl || window.location.origin, window.location.origin);
  const wsUrl = new URL(baseUrl.origin);
  wsUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  wsUrl.pathname = '/ws';
  wsUrl.searchParams.set('token', token);
  return wsUrl.toString();
}

export class WebSocketApiClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelayMs = 1000;
  private requestSeq = 0;
  private subscriptionSeq = 0;
  private manuallyClosed = false;
  private pendingRequests = new Map<string, PendingRequest>();
  private subscriptions = new Map<string, LocalSubscription>();

  constructor(private readonly token: string) {}

  async call<T>(method: string, params?: unknown, timeoutMs = DEFAULT_RPC_TIMEOUT_MS): Promise<T> {
    await this.ensureConnected();

    const result = await this.sendRequest<T>({
      type: 'rpc',
      method,
      params
    }, timeoutMs);

    return result;
  }

  subscribe<T>(
    topic: string,
    params: unknown,
    handler: SubscriptionHandler<T>,
    options?: { onError?: (message: string) => void }
  ): () => void {
    const localId = `sub-${++this.subscriptionSeq}`;
    const subscription: LocalSubscription<T> = {
      localId,
      topic,
      params,
      handler,
      onError: options?.onError
    };

    this.subscriptions.set(localId, subscription);
    void this.ensureConnected()
      .then(() => this.activateSubscription(subscription))
      .catch((error) => {
        subscription.onError?.(toErrorMessage(error));
      });

    return () => {
      this.removeSubscription(localId);
    };
  }

  shutdown(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.rejectPendingRequests(new Error('WebSocket 客户端已关闭'));
    this.subscriptions.clear();
    this.connectPromise = null;

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private buildUrl(): string {
    return resolveWebSocketUrl(this.token);
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.manuallyClosed = false;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socketUrl = this.buildUrl();
      const socket = new WebSocket(socketUrl);
      let settled = false;

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        socket.removeEventListener('open', handleOpen);
        socket.removeEventListener('close', handleConnectFailure);
        socket.removeEventListener('error', handleError);
      };

      const handleOpen = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        this.socket = socket;
        this.reconnectDelayMs = 1000;
        this.attachSocket(socket);
        this.connectPromise = null;
        resolve();
        void this.resubscribeAll();
      };

      const handleConnectFailure = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        this.connectPromise = null;
        reject(new Error(`WebSocket 连接失败: ${socketUrl}`));
      };

      const handleError = () => {
        if (socket.readyState !== WebSocket.CLOSED) {
          return;
        }
        handleConnectFailure();
      };

      const timeoutId = window.setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        socket.close();
        this.connectPromise = null;
        reject(new Error(`WebSocket 连接超时: ${socketUrl}`));
      }, DEFAULT_CONNECT_TIMEOUT_MS);

      socket.addEventListener('open', handleOpen);
      socket.addEventListener('close', handleConnectFailure);
      socket.addEventListener('error', handleError);
    });

    return this.connectPromise;
  }

  private attachSocket(socket: WebSocket): void {
    socket.onmessage = (event) => {
      this.handleSocketMessage(event.data);
    };

    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.connectPromise = null;
      this.clearServerSubscriptionIds();
      this.rejectPendingRequests(new Error('WebSocket 连接已断开'));

      if (!this.manuallyClosed && this.subscriptions.size > 0) {
        this.scheduleReconnect();
      }
    };

    socket.onerror = () => {
      if (socket.readyState === WebSocket.CLOSED && !this.manuallyClosed) {
        this.scheduleReconnect();
      }
    };
  }

  private handleSocketMessage(raw: string): void {
    let payload: unknown;

    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (isRecord(payload) && payload.type === 'event') {
      const eventMessage = payload as WsEventMessage;
      for (const subscription of this.subscriptions.values()) {
        if (subscription.serverSubscriptionId === eventMessage.subscriptionId) {
          subscription.handler(eventMessage.data as never);
        }
      }
      return;
    }

    if (!isRecord(payload) || !('id' in payload)) {
      return;
    }

    const response = payload as WsResponseMessage;
    const requestId = response.id === null ? null : String(response.id);
    if (!requestId) {
      return;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(requestId);

    if (response.ok) {
      pending.resolve(response.result);
      return;
    }

    pending.reject(new Error(response.error?.message || '请求失败'));
  }

  private async sendRequest<T>(payload: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 尚未连接');
    }

    const requestId = String(++this.requestSeq);
    const message = JSON.stringify({
      id: requestId,
      ...payload
    });

    return new Promise<T>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('请求超时'));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeoutId
      });

      socket.send(message);
    });
  }

  private async activateSubscription(subscription: LocalSubscription): Promise<void> {
    if (!this.subscriptions.has(subscription.localId) || subscription.serverSubscriptionId) {
      return;
    }

    const result = await this.sendRequest<{ subscriptionId: string }>({
      type: 'subscribe',
      topic: subscription.topic,
      params: subscription.params
    }, DEFAULT_RPC_TIMEOUT_MS);

    const current = this.subscriptions.get(subscription.localId);
    if (!current) {
      if (result.subscriptionId) {
        void this.sendRequest({
          type: 'unsubscribe',
          subscriptionId: result.subscriptionId
        }, DEFAULT_RPC_TIMEOUT_MS).catch(() => undefined);
      }
      return;
    }

    current.serverSubscriptionId = result.subscriptionId;
  }

  private removeSubscription(localId: string): void {
    const subscription = this.subscriptions.get(localId);
    if (!subscription) {
      return;
    }

    this.subscriptions.delete(localId);
    if (subscription.serverSubscriptionId) {
      void this.sendRequest({
        type: 'unsubscribe',
        subscriptionId: subscription.serverSubscriptionId
      }, DEFAULT_RPC_TIMEOUT_MS).catch(() => undefined);
    }
  }

  private async resubscribeAll(): Promise<void> {
    const subscriptions = Array.from(this.subscriptions.values());
    for (const subscription of subscriptions) {
      subscription.serverSubscriptionId = undefined;
      try {
        await this.activateSubscription(subscription);
      } catch (error) {
        subscription.onError?.(toErrorMessage(error));
      }
    }
  }

  private clearServerSubscriptionIds(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.serverSubscriptionId = undefined;
    }
  }

  private rejectPendingRequests(error: Error): void {
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(error);
      this.pendingRequests.delete(requestId);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected().catch(() => {
        this.scheduleReconnect();
      });
    }, this.reconnectDelayMs);

    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  }
}
