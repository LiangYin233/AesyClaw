import type { IncomingMessage, Server } from 'http';
import { randomUUID } from 'crypto';
import { URL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { NotFoundError } from '../errors.js';
import { createErrorResponse, toAppError } from '../errors.js';
import type { Logger } from '../../platform/observability/logging.js';
import type {
  EventMessage,
  IncomingClientMessage,
  OutgoingServerMessage,
  WebSocketApiError
} from './protocol.js';
import { parseIncomingClientMessage } from './protocol.js';

type RpcHandler = (params: unknown, context: WebSocketRequestContext) => unknown | Promise<unknown>;
type SubscriptionSnapshotResolver = (params: unknown, context: WebSocketRequestContext) => unknown | Promise<unknown>;

interface SubscriptionDefinition {
  getSnapshot: SubscriptionSnapshotResolver;
}

interface WebSocketApiServerOptions {
  server: Server;
  path: string;
  getExpectedToken: () => string | undefined;
  log: Logger;
}

export interface WebSocketRequestContext {
  connectionId: string;
  token: string;
  remoteAddress?: string;
}

interface ActiveSubscription {
  subscriptionId: string;
  topic: string;
  params?: unknown;
}

interface ConnectionState {
  id: string;
  ws: WebSocket;
  context: WebSocketRequestContext;
  subscriptions: Map<string, ActiveSubscription>;
  heartbeatTimer?: NodeJS.Timeout;
  alive: boolean;
}

function toWebSocketError(error: unknown): WebSocketApiError {
  const response = createErrorResponse(error);
  return {
    code: response.code,
    message: response.detail,
    details: response.details,
    field: response.field
  };
}

function writeHandshakeError(socket: IncomingMessage['socket'], statusCode: number, message: string): void {
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`
  );
  socket.destroy();
}

/**
 * 统一承载 WebUI 的 WebSocket RPC 与订阅协议。
 * 连接建立后，所有查询、写操作和实时推送都从这里进出。
 */
export class WebSocketApiServer {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly rpcHandlers = new Map<string, RpcHandler>();
  private readonly subscriptionDefinitions = new Map<string, SubscriptionDefinition>();
  private readonly connections = new Set<ConnectionState>();
  private nextSubscriptionId = 0;
  private readonly upgradeHandler: (request: IncomingMessage, socket: IncomingMessage['socket'], head: Buffer) => void;

  constructor(private readonly options: WebSocketApiServerOptions) {
    this.upgradeHandler = (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    };

    this.options.server.on('upgrade', this.upgradeHandler);
    this.wss.on('connection', (ws, request) => {
      this.handleConnection(ws, request);
    });
  }

  registerRpc(method: string, handler: RpcHandler): void {
    this.rpcHandlers.set(method, handler);
  }

  registerSubscription(topic: string, definition: SubscriptionDefinition): void {
    this.subscriptionDefinitions.set(topic, definition);
  }

  publish(
    topic: string,
    options?: {
      match?: (params: unknown, context: WebSocketRequestContext) => boolean;
    }
  ): void {
    for (const connection of this.connections) {
      for (const subscription of connection.subscriptions.values()) {
        if (subscription.topic !== topic) {
          continue;
        }
        if (options?.match && !options.match(subscription.params, connection.context)) {
          continue;
        }

        void this.pushSubscriptionSnapshot(connection, subscription);
      }
    }
  }

  async close(): Promise<void> {
    this.options.server.off('upgrade', this.upgradeHandler);

    for (const connection of this.connections) {
      if (connection.heartbeatTimer) {
        clearInterval(connection.heartbeatTimer);
      }
      connection.ws.close();
    }

    await new Promise<void>((resolve) => {
      this.wss.close(() => resolve());
    });
  }

  /**
   * 只接管约定好的 `/ws` 路径，并在 upgrade 阶段完成 token 校验。
   * 未通过校验的请求直接按普通 HTTP 错误返回，不进入 WebSocket 生命周期。
   */
  private handleUpgrade(request: IncomingMessage, socket: IncomingMessage['socket'], head: Buffer): void {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    if (requestUrl.pathname !== this.options.path) {
      writeHandshakeError(socket, 404, 'Not Found');
      return;
    }

    const expectedToken = this.options.getExpectedToken();
    const token = requestUrl.searchParams.get('token') || undefined;
    if (!expectedToken || token !== expectedToken) {
      writeHandshakeError(socket, 401, 'Unauthorized');
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      (request as IncomingMessage & { authToken?: string }).authToken = token;
      this.wss.emit('connection', ws, request);
    });
  }

  /**
   * 每条连接都维护独立的订阅集合与心跳状态。
   * 心跳超时后直接终止连接，避免失活订阅长期残留。
   */
  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const token = (request as IncomingMessage & { authToken?: string }).authToken;
    const connectionId = randomUUID();
    const connection: ConnectionState = {
      id: connectionId,
      ws,
      alive: true,
      context: {
        connectionId,
        token: token || '',
        remoteAddress: request.socket.remoteAddress
      },
      subscriptions: new Map<string, ActiveSubscription>()
    };

    this.connections.add(connection);
    this.options.log.info('WebSocket API 连接已建立', {
      connectionId,
      remoteAddress: request.socket.remoteAddress
    });

    ws.on('pong', () => {
      connection.alive = true;
    });

    connection.heartbeatTimer = setInterval(() => {
      if (!connection.alive) {
        ws.terminate();
        return;
      }

      connection.alive = false;
      ws.ping();
    }, 30000);

    ws.on('message', async (raw) => {
      await this.handleMessage(connection, raw.toString());
    });

    ws.on('close', () => {
      if (connection.heartbeatTimer) {
        clearInterval(connection.heartbeatTimer);
      }

      this.connections.delete(connection);
      this.options.log.info('WebSocket API 连接已关闭', {
        connectionId
      });
    });

    ws.on('error', (error) => {
      this.options.log.warn('WebSocket API 连接异常', {
        connectionId,
        error: error.message
      });
    });
  }

  private async handleMessage(connection: ConnectionState, payload: string): Promise<void> {
    let message: IncomingClientMessage;

    try {
      message = parseIncomingClientMessage(JSON.parse(payload));
    } catch (error) {
      this.sendMessage(connection.ws, {
        id: null,
        ok: false,
        error: toWebSocketError(error)
      });
      return;
    }

    if (message.type === 'rpc') {
      await this.handleRpcMessage(connection, message);
      return;
    }

    if (message.type === 'subscribe') {
      await this.handleSubscribeMessage(connection, message);
      return;
    }

    await this.handleUnsubscribeMessage(connection, message);
  }

  private async handleRpcMessage(
    connection: ConnectionState,
    message: Extract<IncomingClientMessage, { type: 'rpc' }>
  ): Promise<void> {
    const handler = this.rpcHandlers.get(message.method);
    if (!handler) {
      this.sendMessage(connection.ws, {
        id: message.id,
        ok: false,
        error: toWebSocketError(new NotFoundError('WebSocket method', message.method))
      });
      return;
    }

    try {
      const result = await handler(message.params, connection.context);
      this.sendMessage(connection.ws, {
        id: message.id,
        ok: true,
        result
      });
    } catch (error) {
      const appError = toAppError(error);
      this.options.log.warn('WebSocket RPC 调用失败', {
        connectionId: connection.id,
        method: message.method,
        error: appError.message,
        code: appError.code
      });
      this.sendMessage(connection.ws, {
        id: message.id,
        ok: false,
        error: toWebSocketError(appError)
      });
    }
  }

  private async handleSubscribeMessage(
    connection: ConnectionState,
    message: Extract<IncomingClientMessage, { type: 'subscribe' }>
  ): Promise<void> {
    const definition = this.subscriptionDefinitions.get(message.topic);
    if (!definition) {
      this.sendMessage(connection.ws, {
        id: message.id,
        ok: false,
        error: toWebSocketError(new NotFoundError('WebSocket topic', message.topic))
      });
      return;
    }

    const subscriptionId = `${connection.id}:${++this.nextSubscriptionId}`;
    const subscription: ActiveSubscription = {
      subscriptionId,
      topic: message.topic,
      params: message.params
    };
    connection.subscriptions.set(subscriptionId, subscription);

    // 先确认订阅已注册成功，再推送首个快照，避免前端拿到无法续订的孤立事件。
    this.sendMessage(connection.ws, {
      id: message.id,
      ok: true,
      result: {
        subscriptionId
      }
    });

    try {
      await this.pushSubscriptionSnapshot(connection, subscription, definition);
    } catch (error) {
      connection.subscriptions.delete(subscriptionId);
      this.options.log.warn('WebSocket 订阅初始化失败', {
        connectionId: connection.id,
        topic: message.topic,
        subscriptionId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.sendMessage(connection.ws, {
        id: null,
        ok: false,
        error: toWebSocketError(error)
      });
    }
  }

  private async handleUnsubscribeMessage(
    connection: ConnectionState,
    message: Extract<IncomingClientMessage, { type: 'unsubscribe' }>
  ): Promise<void> {
    connection.subscriptions.delete(message.subscriptionId);
    this.sendMessage(connection.ws, {
      id: message.id,
      ok: true,
      result: {
        success: true
      }
    });
  }

  private async pushSubscriptionSnapshot(
    connection: ConnectionState,
    subscription: ActiveSubscription,
    definition?: SubscriptionDefinition
  ): Promise<void> {
    const resolvedDefinition = definition ?? this.subscriptionDefinitions.get(subscription.topic);
    if (!resolvedDefinition) {
      throw new NotFoundError('WebSocket topic', subscription.topic);
    }

    // 订阅统一推送最新快照，不承担事件回放职责。
    const data = await resolvedDefinition.getSnapshot(subscription.params, connection.context);
    const event: EventMessage = {
      type: 'event',
      subscriptionId: subscription.subscriptionId,
      topic: subscription.topic,
      data
    };
    this.sendMessage(connection.ws, event);
  }

  private sendMessage(ws: WebSocket, message: OutgoingServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(JSON.stringify(message));
  }
}
