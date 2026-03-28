import type { IncomingMessage, Server } from 'http';
import { randomUUID } from 'crypto';
import { URL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { NotFoundError } from '../errors.js';
import { createErrorResponse, toAppError } from '../errors.js';
import { RequestValidationError } from '../../platform/errors/boundary.js';
import type { Logger } from '../../platform/observability/logging.js';

interface WebSocketApiError {
  code: string;
  message: string;
  details?: unknown;
  field?: string;
}

interface RpcRequestMessage {
  id: string | number;
  type: 'rpc';
  method: string;
  params?: unknown;
}

interface SubscribeRequestMessage {
  id: string | number;
  type: 'subscribe';
  topic: string;
  params?: unknown;
}

interface UnsubscribeRequestMessage {
  id: string | number;
  type: 'unsubscribe';
  subscriptionId: string;
}

type IncomingClientMessage = RpcRequestMessage | SubscribeRequestMessage | UnsubscribeRequestMessage;

interface SuccessResponseMessage {
  id: string | number | null;
  ok: true;
  result: unknown;
}

interface ErrorResponseMessage {
  id: string | number | null;
  ok: false;
  error: WebSocketApiError;
}

interface EventMessage {
  type: 'event';
  subscriptionId: string;
  topic: string;
  data: unknown;
}

type OutgoingServerMessage = SuccessResponseMessage | ErrorResponseMessage | EventMessage;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRequestId(value: unknown): string | number {
  if (typeof value === 'string' || typeof value === 'number') return value;
  throw new RequestValidationError('id must be a string or number', 'id');
}

function parseIncomingClientMessage(raw: unknown): IncomingClientMessage {
  if (!isRecord(raw)) throw new RequestValidationError('WebSocket message must be an object');
  const id = parseRequestId(raw.id);
  const type = raw.type as string;
  if (type === 'rpc') {
    const msg = raw as unknown as RpcRequestMessage;
    if (typeof msg.method !== 'string' || !msg.method.trim()) throw new RequestValidationError('rpc method is required', 'method');
    return { id, type, method: msg.method, params: msg.params };
  }
  if (type === 'subscribe') {
    const msg = raw as unknown as SubscribeRequestMessage;
    if (typeof msg.topic !== 'string' || !msg.topic.trim()) throw new RequestValidationError('subscription topic is required', 'topic');
    return { id, type, topic: msg.topic, params: msg.params };
  }
  if (type === 'unsubscribe') {
    const msg = raw as unknown as UnsubscribeRequestMessage;
    if (typeof msg.subscriptionId !== 'string' || !msg.subscriptionId.trim()) throw new RequestValidationError('subscriptionId is required', 'subscriptionId');
    return { id, type, subscriptionId: msg.subscriptionId };
  }
  throw new RequestValidationError('type must be rpc, subscribe, or unsubscribe', 'type');
}

function toWebSocketError(error: unknown): WebSocketApiError {
  const response = createErrorResponse(error);
  return { code: response.code, message: response.detail, details: response.details, field: response.field };
}

function writeHandshakeError(socket: IncomingMessage['socket'], statusCode: number, message: string): void {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
  socket.destroy();
}

export class WebSocketApiServer {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly rpcHandlers = new Map<string, RpcHandler>();
  private readonly subscriptionDefinitions = new Map<string, SubscriptionDefinition>();
  private readonly connections = new Set<ConnectionState>();
  private nextSubscriptionId = 0;
  private readonly upgradeHandler: (request: IncomingMessage, socket: IncomingMessage['socket'], head: Buffer) => void;

  constructor(private readonly options: WebSocketApiServerOptions) {
    this.upgradeHandler = (request, socket, head) => this.handleUpgrade(request, socket, head);
    this.options.server.on('upgrade', this.upgradeHandler);
    this.wss.on('connection', (ws, request) => this.handleConnection(ws, request));
  }

  registerRpc(method: string, handler: RpcHandler): void { this.rpcHandlers.set(method, handler); }
  registerSubscription(topic: string, definition: SubscriptionDefinition): void { this.subscriptionDefinitions.set(topic, definition); }

  publish(topic: string, options?: { match?: (params: unknown, context: WebSocketRequestContext) => boolean }): void {
    for (const connection of this.connections) {
      for (const subscription of connection.subscriptions.values()) {
        if (subscription.topic !== topic) continue;
        if (options?.match && !options.match(subscription.params, connection.context)) continue;
        void this.pushSubscriptionSnapshot(connection, subscription);
      }
    }
  }

  async close(): Promise<void> {
    this.options.server.off('upgrade', this.upgradeHandler);
    for (const connection of this.connections) {
      if (connection.heartbeatTimer) clearInterval(connection.heartbeatTimer);
      connection.ws.close();
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private handleUpgrade(request: IncomingMessage, socket: IncomingMessage['socket'], head: Buffer): void {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    if (requestUrl.pathname !== this.options.path) { writeHandshakeError(socket, 404, 'Not Found'); return; }
    const expectedToken = this.options.getExpectedToken();
    const token = requestUrl.searchParams.get('token') || undefined;
    if (!expectedToken || token !== expectedToken) { writeHandshakeError(socket, 401, 'Unauthorized'); return; }
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      (request as IncomingMessage & { authToken?: string }).authToken = token;
      this.wss.emit('connection', ws, request);
    });
  }

  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const token = (request as IncomingMessage & { authToken?: string }).authToken;
    const connectionId = randomUUID();
    const connection: ConnectionState = {
      id: connectionId, ws, alive: true,
      context: { connectionId, token: token || '', remoteAddress: request.socket.remoteAddress },
      subscriptions: new Map()
    };
    this.connections.add(connection);
    this.options.log.info('WebSocket API 连接已建立', { connectionId, remoteAddress: request.socket.remoteAddress });

    ws.on('pong', () => { connection.alive = true; });
    connection.heartbeatTimer = setInterval(() => {
      if (!connection.alive) { ws.terminate(); return; }
      connection.alive = false;
      ws.ping();
    }, 30000);

    ws.on('message', async (raw) => { await this.handleMessage(connection, raw.toString()); });
    ws.on('close', () => {
      if (connection.heartbeatTimer) clearInterval(connection.heartbeatTimer);
      this.connections.delete(connection);
      this.options.log.info('WebSocket API 连接已关闭', { connectionId });
    });
    ws.on('error', (error) => { this.options.log.warn('WebSocket API 连接异常', { connectionId, error: error.message }); });
  }

  private async handleMessage(connection: ConnectionState, payload: string): Promise<void> {
    let message: IncomingClientMessage;
    try { message = parseIncomingClientMessage(JSON.parse(payload)); }
    catch (error) { this.sendMessage(connection.ws, { id: null, ok: false, error: toWebSocketError(error) }); return; }
    if (message.type === 'rpc') { await this.handleRpcMessage(connection, message); return; }
    if (message.type === 'subscribe') { await this.handleSubscribeMessage(connection, message); return; }
    await this.handleUnsubscribeMessage(connection, message);
  }

  private async handleRpcMessage(connection: ConnectionState, message: Extract<IncomingClientMessage, { type: 'rpc' }>): Promise<void> {
    const handler = this.rpcHandlers.get(message.method);
    if (!handler) { this.sendMessage(connection.ws, { id: message.id, ok: false, error: toWebSocketError(new NotFoundError('WebSocket method', message.method)) }); return; }
    try {
      const result = await handler(message.params, connection.context);
      this.sendMessage(connection.ws, { id: message.id, ok: true, result });
    } catch (error) {
      const appError = toAppError(error);
      this.options.log.warn('WebSocket RPC 调用失败', { connectionId: connection.id, method: message.method, error: appError.message, code: appError.code });
      this.sendMessage(connection.ws, { id: message.id, ok: false, error: toWebSocketError(appError) });
    }
  }

  private async handleSubscribeMessage(connection: ConnectionState, message: Extract<IncomingClientMessage, { type: 'subscribe' }>): Promise<void> {
    const definition = this.subscriptionDefinitions.get(message.topic);
    if (!definition) { this.sendMessage(connection.ws, { id: message.id, ok: false, error: toWebSocketError(new NotFoundError('WebSocket topic', message.topic)) }); return; }
    const subscriptionId = `${connection.id}:${++this.nextSubscriptionId}`;
    const subscription: ActiveSubscription = { subscriptionId, topic: message.topic, params: message.params };
    connection.subscriptions.set(subscriptionId, subscription);
    this.sendMessage(connection.ws, { id: message.id, ok: true, result: { subscriptionId } });
    try { await this.pushSubscriptionSnapshot(connection, subscription, definition); }
    catch (error) {
      connection.subscriptions.delete(subscriptionId);
      this.options.log.warn('WebSocket 订阅初始化失败', { connectionId: connection.id, topic: message.topic, subscriptionId, error: error instanceof Error ? error.message : String(error) });
      this.sendMessage(connection.ws, { id: null, ok: false, error: toWebSocketError(error) });
    }
  }

  private handleUnsubscribeMessage(connection: ConnectionState, message: Extract<IncomingClientMessage, { type: 'unsubscribe' }>): void {
    connection.subscriptions.delete(message.subscriptionId);
    this.sendMessage(connection.ws, { id: message.id, ok: true, result: { success: true } });
  }

  private async pushSubscriptionSnapshot(connection: ConnectionState, subscription: ActiveSubscription, definition?: SubscriptionDefinition): Promise<void> {
    const resolvedDefinition = definition ?? this.subscriptionDefinitions.get(subscription.topic);
    if (!resolvedDefinition) throw new NotFoundError('WebSocket topic', subscription.topic);
    const data = await resolvedDefinition.getSnapshot(subscription.params, connection.context);
    this.sendMessage(connection.ws, { type: 'event', subscriptionId: subscription.subscriptionId, topic: subscription.topic, data });
  }

  private sendMessage(ws: WebSocket, message: OutgoingServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }
}
