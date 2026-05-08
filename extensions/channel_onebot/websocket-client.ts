import { isRecord, errorMessage } from '@aesyclaw/sdk';
import type { ChannelContext } from '@aesyclaw/sdk';

const WEBSOCKET_OPEN = 1;
const RECONNECT_INTERVAL_MS = 5000;
const ACTION_TIMEOUT_MS = 15000;
const DOWNLOAD_STREAM_TIMEOUT_MS = 5 * 60 * 1000;

export type OneBotApiResponse = {
  status?: string;
  retcode?: number;
  msg?: string;
  wording?: string;
  echo?: string;
  data?: unknown;
};

export type OneBotActionTransport = {
  sendAction(action: string, params: Record<string, unknown>): Promise<OneBotApiResponse>;
};

export type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
};

type OneBotChannelConfig = {
  serverUrl: string;
  accessToken?: string;
};

type OneBotLogger = ChannelContext['logger'];

type PendingRequest<T> = {
  resolve(response: T): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

type PendingStreamRequest = {
  responses: OneBotApiResponse[];
} & PendingRequest<OneBotApiResponse[]>;

type GlobalWithWebSocket = {
  WebSocket?: new (url: string) => WebSocketLike;
};

export type OneBotWebSocketClientOptions = {
  config: OneBotChannelConfig;
  logger: OneBotLogger;
  onPayload(payload: Record<string, unknown>): Promise<void>;
};

export type OneBotWebSocketClient = OneBotActionTransport & {
  start(initial?: boolean): Promise<void>;
  stop(error: Error): void;
  sendStreamAction(action: string, params: Record<string, unknown>): Promise<OneBotApiResponse[]>;
};

export function createOneBotWebSocketClient({
  config,
  logger,
  onPayload,
}: OneBotWebSocketClientOptions): OneBotWebSocketClient {
  let socket: WebSocketLike | null = null;
  let connectingSocket: WebSocketLike | null = null;
  let connectPromise: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let nextEcho = 0;
  let destroyed = false;
  const pending = new Map<string, PendingRequest<OneBotApiResponse>>();
  const pendingStreams = new Map<string, PendingStreamRequest>();

  return {
    start: ensureConnected,
    stop(error) {
      destroyed = true;
      clearReconnectTimer();
      rejectPendingRequests(pending, error);
      rejectPendingRequests(pendingStreams, error);

      const activeSocket = socket;
      const openingSocket = connectingSocket;
      socket = null;
      connectingSocket = null;
      connectPromise = null;
      openingSocket?.close();
      activeSocket?.close();
    },
    async sendAction(action, params) {
      return await sendSocketActionRequest({
        action,
        params,
        echoPrefix: 'onebot',
        timeoutMs: ACTION_TIMEOUT_MS,
        timeoutMessage: `OneBot action "${action}" timed out after ${ACTION_TIMEOUT_MS}ms`,
        sendFailureMessage: (err) =>
          `Failed to send OneBot action "${action}": ${errorMessage(err)}`,
        requests: pending,
      });
    },
    async sendStreamAction(action, params) {
      return await sendSocketActionRequest({
        action,
        params,
        echoPrefix: 'onebot-stream',
        timeoutMs: DOWNLOAD_STREAM_TIMEOUT_MS,
        timeoutMessage: `OneBot stream action "${action}" timed out after ${DOWNLOAD_STREAM_TIMEOUT_MS}ms`,
        sendFailureMessage: (err) =>
          `Failed to send OneBot stream action "${action}": ${errorMessage(err)}`,
        requests: pendingStreams,
        createRequest: (base) => ({ ...base, responses: [] }),
      });
    },
  };

  async function ensureConnected(initial = false): Promise<void> {
    if (destroyed) {
      throw new Error('OneBot channel is destroyed');
    }
    if (socket?.readyState === WEBSOCKET_OPEN) {
      return;
    }
    if (connectPromise) {
      return await connectPromise;
    }

    clearReconnectTimer();
    connectPromise = connectSocket(initial).finally(() => {
      connectPromise = null;
    });
    return await connectPromise;
  }

  async function connectSocket(initial: boolean): Promise<void> {
    const connectionUrl = buildSocketUrl(config.serverUrl, config.accessToken);
    const candidate = defaultCreateSocket(connectionUrl);
    connectingSocket = candidate;
    try {
      await waitForSocketOpen(candidate);
    } finally {
      if (connectingSocket === candidate) {
        connectingSocket = null;
      }
    }

    if (destroyed) {
      candidate.close();
      return;
    }

    socket = candidate;
    attachSocketHandlers(candidate);
    logger.info(initial ? 'OneBot websocket connected' : 'OneBot websocket reconnected', {
      serverUrl: sanitizeServerUrl(config.serverUrl),
    });
  }

  function attachSocketHandlers(activeSocket: WebSocketLike): void {
    activeSocket.addEventListener('message', (event) => {
      if (socket !== activeSocket) {
        return;
      }
      void handleSocketMessage(event);
    });
    activeSocket.addEventListener('close', () => {
      if (socket !== activeSocket) {
        return;
      }
      handleSocketClose();
    });
    activeSocket.addEventListener('error', (event) => {
      if (socket !== activeSocket) {
        return;
      }
      logger.warn('OneBot websocket error', {
        serverUrl: sanitizeServerUrl(config.serverUrl),
        error: describeSocketError(event),
      });
    });
  }

  async function handleSocketMessage(event: unknown): Promise<void> {
    const payload = parseSocketPayload(event);
    if (!payload) {
      return;
    }

    const apiResponse = parseApiResponsePayload(payload);
    if (apiResponse?.echo) {
      if (consumePendingStreamResponse(apiResponse.echo, apiResponse)) {
        return;
      }
      cleanupPendingRequest(pending, apiResponse.echo)?.resolve(apiResponse);
      return;
    }

    try {
      await onPayload(payload);
    } catch (err) {
      logger.error('Failed to process OneBot websocket payload', err);
    }
  }

  function handleSocketClose(): void {
    socket = null;
    rejectPendingRequests(pending, new Error('OneBot websocket disconnected'));
    rejectPendingRequests(pendingStreams, new Error('OneBot websocket disconnected'));

    if (destroyed) {
      return;
    }

    logger.warn('OneBot websocket disconnected', {
      serverUrl: sanitizeServerUrl(config.serverUrl),
      reconnectInMs: RECONNECT_INTERVAL_MS,
    });

    scheduleReconnect();
  }

  function scheduleReconnect(): void {
    if (destroyed || reconnectTimer) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void ensureConnected(false).catch((err) => {
        logger.error('Failed to reconnect OneBot websocket', err);
        scheduleReconnect();
      });
    }, RECONNECT_INTERVAL_MS);
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function consumePendingStreamResponse(echo: string, response: OneBotApiResponse): boolean {
    const request = pendingStreams.get(echo);
    if (!request) {
      return false;
    }

    request.responses.push(response);
    const data = isRecord(response.data) ? response.data : null;

    if (response.status !== 'ok' || data?.['type'] === 'error') {
      cleanupPendingRequest(pendingStreams, echo)?.reject(
        new Error(
          response.wording ??
            response.msg ??
            `OneBot stream action failed with status ${response.status ?? 'failed'}`,
        ),
      );
      return true;
    }

    if (data?.['type'] === 'response') {
      cleanupPendingRequest(pendingStreams, echo)?.resolve(request.responses);
      return true;
    }

    return true;
  }

  async function sendSocketActionRequest<
    T,
    TRequest extends PendingRequest<T> = PendingRequest<T>,
  >({
    action,
    params,
    echoPrefix,
    timeoutMs,
    timeoutMessage,
    sendFailureMessage,
    requests,
    createRequest,
  }: {
    action: string;
    params: Record<string, unknown>;
    echoPrefix: string;
    timeoutMs: number;
    timeoutMessage: string;
    sendFailureMessage: (err: unknown) => string;
    requests: Map<string, TRequest>;
    createRequest?: (base: PendingRequest<T>) => TRequest;
  }): Promise<T> {
    await ensureConnected();
    const activeSocket = socket;
    if (activeSocket?.readyState !== WEBSOCKET_OPEN) {
      throw new Error('OneBot websocket is not connected');
    }

    const echo = `${echoPrefix}-${Date.now()}-${++nextEcho}`;
    return await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        requests.delete(echo);
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      const request = buildPendingRequest({ resolve, reject, timeout });
      requests.set(echo, createRequest ? createRequest(request) : (request as TRequest));

      try {
        activeSocket.send(JSON.stringify({ action, params, echo }));
      } catch (err) {
        cleanupPendingRequest(requests, echo);
        reject(new Error(sendFailureMessage(err)));
      }
    });
  }
}

function buildPendingRequest<T>({
  resolve,
  reject,
  timeout,
}: {
  resolve(value: T): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}): PendingRequest<T> {
  return {
    resolve: (response) => {
      clearTimeout(timeout);
      resolve(response);
    },
    reject: (error) => {
      clearTimeout(timeout);
      reject(error);
    },
    timeout,
  };
}

function cleanupPendingRequest<T, TRequest extends PendingRequest<T>>(
  requests: Map<string, TRequest>,
  echo: string,
): TRequest | null {
  const request = requests.get(echo) ?? null;
  if (!request) {
    return null;
  }

  clearTimeout(request.timeout);
  requests.delete(echo);
  return request;
}

function rejectPendingRequests<T, TRequest extends PendingRequest<T>>(
  requests: Map<string, TRequest>,
  error: Error,
): void {
  for (const [echo, request] of requests.entries()) {
    requests.delete(echo);
    clearTimeout(request.timeout);
    request.reject(error);
  }
}

function buildSocketUrl(serverUrl: string, accessToken: string | undefined): string {
  const url = new URL(serverUrl);
  if (accessToken) {
    url.searchParams.set('access_token', accessToken);
  }
  return url.toString();
}

function sanitizeServerUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.searchParams.delete('access_token');
  return url.toString();
}

function defaultCreateSocket(url: string): WebSocketLike {
  const ctor = (globalThis as GlobalWithWebSocket).WebSocket;
  if (!ctor) {
    throw new Error('Global WebSocket client is not available in this runtime');
  }
  return new ctor(url);
}

function waitForSocketOpen(socket: WebSocketLike): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleOpen = (): void => {
      cleanup();
      resolve();
    };
    const handleClose = (event: unknown): void => {
      cleanup();
      reject(new Error(`OneBot websocket closed before opening: ${describeSocketClose(event)}`));
    };
    const handleError = (event: unknown): void => {
      cleanup();
      reject(new Error(`Failed to connect to OneBot websocket: ${describeSocketError(event)}`));
    };
    const cleanup = (): void => {
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('close', handleClose);
      socket.removeEventListener('error', handleError);
    };

    socket.addEventListener('open', handleOpen);
    socket.addEventListener('close', handleClose);
    socket.addEventListener('error', handleError);
  });
}

function parseSocketPayload(event: unknown): Record<string, unknown> | null {
  const text = readSocketData(event);
  if (!text) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readSocketData(event: unknown): string | null {
  if (typeof event === 'string') {
    return event;
  }
  if (!isRecord(event)) {
    return null;
  }

  const data = event['data'];
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data as ArrayBuffer | ArrayBufferView);
  }
  return null;
}

function parseApiResponsePayload(payload: Record<string, unknown>): OneBotApiResponse | null {
  if (
    typeof payload['echo'] !== 'string' ||
    (!('status' in payload) && !('retcode' in payload) && !('data' in payload))
  ) {
    return null;
  }

  return {
    echo: payload['echo'],
    ...(typeof payload['status'] === 'string' ? { status: payload['status'] } : {}),
    ...(typeof payload['retcode'] === 'number' ? { retcode: payload['retcode'] } : {}),
    ...(typeof payload['msg'] === 'string' ? { msg: payload['msg'] } : {}),
    ...(typeof payload['wording'] === 'string' ? { wording: payload['wording'] } : {}),
    ...('data' in payload ? { data: payload['data'] } : {}),
  };
}

function describeSocketError(event: unknown): string {
  if (event instanceof Error) {
    return event.message;
  }
  if (isRecord(event)) {
    if (event['error'] instanceof Error) {
      return event['error'].message;
    }
    if (typeof event['message'] === 'string') {
      return event['message'];
    }
  }
  return 'unknown websocket error';
}

function describeSocketClose(event: unknown): string {
  if (!isRecord(event)) {
    return 'closed';
  }

  const code = typeof event['code'] === 'number' ? event['code'] : undefined;
  const reason =
    typeof event['reason'] === 'string' && event['reason'].length > 0 ? event['reason'] : undefined;
  if (code !== undefined && reason) {
    return `code ${code}: ${reason}`;
  }
  if (code !== undefined) {
    return `code ${code}`;
  }
  if (reason) {
    return reason;
  }
  return 'closed';
}
