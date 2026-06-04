/**
 * ws-server — WebSocket 传输层。
 *
 * 负责客户端连接管理、鉴权、心跳、文本/二进制帧路由。
 * 不包含任何业务协议逻辑（聊天/文件/流式事件等）。
 */

import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { createScopedLogger } from '@aesyclaw/sdk';
import { validateDesktopToken } from './auth';
import { DesktopSessionManager, type DesktopConnection } from './session-manager';

const HEARTBEAT_INTERVAL_MS = 30_000;
const CLIENT_ALIVE_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 2 + 5_000;

export type WsServerOptions = {
  port: number;
  host?: string;
  authToken: string;
  getCommands: () => Array<{ name: string; description: string }>;
  onJsonMessage(connectionId: string, raw: string): void;
  onBinaryFrame(connectionId: string, data: Buffer): void;
};

export class WsServer {
  private wss: WebSocketServer | null = null;
  readonly sessions = new DesktopSessionManager();
  private logger = createScopedLogger('channel:desktop:ws');
  readonly getCommands: () => Array<{ name: string; description: string }>;

  constructor(private options: WsServerOptions) {
    this.getCommands = options.getCommands;
  }

  async start(): Promise<void> {
    return await new Promise((resolve, reject) => {
      const { port, host } = this.options;
      this.wss = new WebSocketServer({ port, host: host ?? '127.0.0.1' });

      this.wss.on('listening', () => {
        this.logger.info('Desktop WebSocket 服务器已启动', { port, host });
        resolve();
      });
      this.wss.on('error', (err) => {
        this.logger.error('WebSocket 服务器错误', err);
        reject(err);
      });
      this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
      this.startHeartbeat();
    });
  }

  async stop(): Promise<void> {
    this.wss?.close();
    this.wss = null;
    this.logger.info('Desktop WebSocket 服务器已停止');
  }

  // ─── 连接管理 ──────────────────────────────────────────────────

  private handleConnection(ws: WebSocket, req: { url?: string }): void {
    if (!this.validateToken(req.url)) {
      this.logger.warn('Desktop 客户端鉴权失败，关闭连接');
      ws.close(4001, 'Unauthorized');
      return;
    }

    const connectionId = randomUUID();
    const connection = this.createConnection(connectionId, ws);
    this.sessions.register(connection);

    this.logger.info('Desktop 客户端已连接', { connectionId });
    connection.sendJson({
      type: 'auth',
      commands: this.getCommands(),
    });

    this.setupConnectionLifetime(connectionId, connection, ws);
  }

  private validateToken(url: string | undefined): boolean {
    return validateDesktopToken(url, this.options.authToken);
  }

  private createConnection(id: string, ws: WebSocket): DesktopConnection {
    return {
      id,
      sessions: new Set(),
      fileBuffers: new Map(),
      completedFiles: new Map(),

      sendJson(data: unknown): void {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
      },
      sendBinary(data: Buffer): void {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
      close(code?: number, reason?: string): void {
        ws.close(code, reason);
      },
    };
  }

  private setupConnectionLifetime(
    connectionId: string,
    connection: DesktopConnection,
    ws: WebSocket,
  ): void {
    let clientAlive = true;
    let pongTimeout: ReturnType<typeof setTimeout> | null = null;

    const resetPongTimer = (): void => {
      if (pongTimeout) clearTimeout(pongTimeout);
      pongTimeout = setTimeout(() => {
        this.logger.warn('Desktop 客户端心跳超时', { connectionId });
        connection.close(4002, 'Heartbeat timeout');
      }, CLIENT_ALIVE_TIMEOUT_MS);
    };
    resetPongTimer();

    ws.on('pong', () => {
      clientAlive = true;
      resetPongTimer();
    });

    const heartbeatTimer = setInterval(() => {
      if (!clientAlive) {
        connection.close(4002, 'Heartbeat timeout');
        return;
      }
      clientAlive = false;
      ws.ping();
      connection.sendJson({ type: 'ping' });
    }, HEARTBEAT_INTERVAL_MS);

    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        this.options.onBinaryFrame(connectionId, buffer);
        return;
      }
      this.options.onJsonMessage(connectionId, raw.toString());
    });

    ws.on('close', () => {
      clearInterval(heartbeatTimer);
      if (pongTimeout) clearTimeout(pongTimeout);
      this.sessions.unregister(connectionId);
      this.logger.info('Desktop 客户端已断开', { connectionId });
    });

    ws.on('error', (err) => {
      this.logger.error('Desktop WebSocket 连接错误', { connectionId }, err);
    });
  }

  // ─── 心跳 ──────────────────────────────────────────────────────

  private startHeartbeat(): void {
    const interval = setInterval(() => {
      for (const conn of this.sessions.activeConnections) {
        conn.sendJson({ type: 'ping' });
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.wss?.on('close', () => clearInterval(interval));
  }
}
