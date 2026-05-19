/** WebSocket 服务器 — 接受 Electron 客户端连接并桥接消息。
 *
 * 基于 ws 库实现：
 * - 鉴权（URL query token）
 * - JSON 文本帧 + 二进制帧混合协议
 * - 文件分片重组
 * - 心跳管理
 * - 连接生命周期
 */

import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createScopedLogger } from '@aesyclaw/sdk';
import { DesktopSessionManager, type DesktopConnection } from './session-manager';
import type {
  DesktopInboundMessage,
  DesktopOutboundMessage,
  DesktopFileBuffer,
  DesktopReceivedFile,
} from './types';
import type { ChannelContext, MessageComponent, StreamMessage } from '@aesyclaw/sdk';

const HEARTBEAT_INTERVAL_MS = 30_000;
const CLIENT_ALIVE_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 2 + 5_000;

function safeTokenEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

function sanitizeFileName(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\p{C}/gu, '_')
    .trim();
  return sanitized.length > 0 ? sanitized : 'upload.bin';
}

function sanitizePathSegment(segment: string): string {
  const sanitized = segment.replace(/[^a-z0-9._-]/gi, '_').trim();
  return sanitized.length > 0 ? sanitized : 'session';
}

function fileComponentType(mime: string): 'Image' | 'Record' | 'Video' | 'File' {
  if (mime.startsWith('image/')) return 'Image';
  if (mime.startsWith('audio/')) return 'Record';
  if (mime.startsWith('video/')) return 'Video';
  return 'File';
}

function attachmentKind(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

function fileToMessageComponent(file: DesktopReceivedFile): MessageComponent {
  const type = fileComponentType(file.mime);
  return {
    type,
    ['path']: file.filePath,
    file: file.name,
    name: file.name,
    mimeType: file.mime,
  } as MessageComponent;
}

function formatAttachmentText(attachments: DesktopReceivedFile[]): string {
  if (attachments.length === 0) return '';
  return [
    '[Attachments]',
    ...attachments.map(
      (file) => `- ${attachmentKind(file.mime)}: ${file.filePath} (${file.name}, ${file.mime})`,
    ),
  ].join('\n');
}

export type DesktopServerOptions = {
  port: number;
  host?: string;
  authToken: string;
  adminToken: string;
  context: ChannelContext;
};

export class DesktopServer {
  private wss: WebSocketServer | null = null;
  private sessions = new DesktopSessionManager();
  private options: DesktopServerOptions;
  private logger = createScopedLogger('channel:desktop:server');

  constructor(options: DesktopServerOptions) {
    this.options = options;
  }

  /** 启动 WebSocket 服务器 */
  async start(): Promise<void> {
    return await new Promise((resolve, reject) => {
      const { port, host } = this.options;
      this.wss = new WebSocketServer({ port, host: host ?? '127.0.0.1' });

      this.wss.on('listening', () => {
        this.logger.info(`Desktop WebSocket 服务器已启动`, { port, host });
        resolve();
      });

      this.wss.on('error', (err) => {
        this.logger.error('WebSocket 服务器错误', err);
        reject(err);
      });

      this.wss.on('connection', (ws, req) => {
        this.handleConnection(ws, req);
      });

      // 启动心跳
      this.startHeartbeat();
    });
  }

  /** 停止服务器 */
  async stop(): Promise<void> {
    this.wss?.close();
    this.wss = null;
    this.logger.info('Desktop WebSocket 服务器已停止');
  }

  /** 向指定 session 的所有连接发送下行消息 */
  sendToSession(sessionId: string, message: DesktopOutboundMessage): void {
    const conn = this.sessions.getConnection(sessionId);
    if (!conn) return;
    conn.sendJson(message);
  }

  /** 处理来自 AesyClaw 内部的流式事件，转换为下行消息发送 */
  forwardStreamEvent(sessionId: string, streamMsg: StreamMessage): void {
    const conn = this.sessions.getConnection(sessionId);
    if (!conn) return;

    switch (streamMsg.event) {
      case 'chunk': {
        const text = (streamMsg.components[0] as { text?: string })?.text ?? '';
        conn.sendJson({
          type: 'chunk',
          sessionId,
          text,
          index: streamMsg.chunkIndex ?? 0,
        } satisfies DesktopOutboundMessage);
        break;
      }
      case 'toolCall':
        conn.sendJson({
          type: 'tool_call',
          sessionId,
          toolCallId: streamMsg.toolCallId ?? '',
          toolName: streamMsg.toolName ?? '',
          args: streamMsg.args,
        } satisfies DesktopOutboundMessage);
        break;
      case 'toolResult':
        conn.sendJson({
          type: 'tool_result',
          sessionId,
          toolCallId: streamMsg.toolCallId ?? '',
          toolName: streamMsg.toolName ?? '',
          result: streamMsg.result,
          isError: streamMsg.isError ?? false,
        } satisfies DesktopOutboundMessage);
        break;
      case 'done':
        conn.sendJson({
          type: 'done',
          sessionId,
        } satisfies DesktopOutboundMessage);
        break;
      case 'error':
        conn.sendJson({
          type: 'error',
          sessionId,
          message: streamMsg.errorMessage ?? '未知错误',
        } satisfies DesktopOutboundMessage);
        break;
    }
  }

  // ─── 私有方法 ──────────────────────────────────────────────────

  private handleConnection(ws: WebSocket, req: { url?: string }): void {
    // 鉴权
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
      adminToken: this.options.adminToken,
    } satisfies DesktopOutboundMessage);

    // 心跳管理
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
      connection.sendJson({ type: 'ping' } satisfies DesktopOutboundMessage);
    }, HEARTBEAT_INTERVAL_MS);

    // 文本消息
    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        // 二进制帧 = 文件数据块
        const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        this.handleBinaryFrame(connectionId, buffer);
        return;
      }

      // 文本帧 = JSON 消息。ws 在 Node 端通常也会以 Buffer 承载文本帧，
      // 必须依赖 isBinary 判断，不能用 Buffer instanceof 区分。
      this.handleJsonMessage(connectionId, raw.toString());
    });

    // 关闭
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

  private createConnection(id: string, ws: WebSocket): DesktopConnection {
    return {
      id,
      sessions: new Set(),
      fileBuffers: new Map(),
      completedFiles: new Map(),
      sendJson(data: unknown): void {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(data));
        }
      },
      sendBinary(data: Buffer): void {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
        }
      },
      close(code?: number, reason?: string): void {
        ws.close(code, reason);
      },
    };
  }

  private validateToken(url: string | undefined): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url, 'http://localhost');
      const token = parsed.searchParams.get('token');
      if (!token) return false;
      return safeTokenEqual(token, this.options.authToken);
    } catch {
      return false;
    }
  }

  private handleJsonMessage(connectionId: string, raw: string): void {
    let msg: DesktopInboundMessage;
    try {
      msg = JSON.parse(raw) as DesktopInboundMessage;
    } catch {
      this.logger.warn('无效的 JSON 消息', { connectionId });
      return;
    }

    switch (msg.type) {
      case 'chat':
        void this.handleChatMessage(connectionId, msg);
        break;
      case 'cancel':
        this.handleCancelMessage(connectionId, msg);
        break;
      case 'file_start':
        this.handleFileStart(connectionId, msg);
        break;
      case 'file_end':
        this.handleFileEnd(connectionId, msg);
        break;
      case 'pong':
        // 由 pong 事件处理
        break;
      default:
        this.logger.warn('未知消息类型', {
          connectionId,
          type: (msg as Record<string, unknown>)['type'],
        });
    }
  }

  private async handleChatMessage(
    connectionId: string,
    msg: {
      type: 'chat';
      sessionId: string;
      text: string;
      files?: Array<{ fileId?: string; name: string; mime: string; size?: number }>;
    },
  ): Promise<void> {
    const { sessionId } = msg;
    this.sessions.bindSession(sessionId, connectionId);

    const sessionKey = this.sessions.makeSessionKey(sessionId);
    const conn = this.sessions.getConnection(sessionId);
    if (!conn) return;
    const attachments = this.consumeChatAttachments(conn, sessionId, msg.files ?? []);
    const message = {
      components: this.buildMessageComponents(msg.text, attachments),
    };

    try {
      this.logger.info('收到 Desktop 聊天消息', { connectionId, sessionId });
      await this.options.context.receive(message, sessionKey, {
        id: connectionId,
        name: `Desktop-${connectionId.slice(0, 8)}`,
      });
    } catch (err) {
      this.logger.error('处理聊天消息失败', { connectionId, sessionId }, err);
      conn.sendJson({
        type: 'error',
        sessionId,
        message: err instanceof Error ? err.message : '处理聊天消息失败',
      } satisfies DesktopOutboundMessage);
    }
  }

  private handleCancelMessage(
    connectionId: string,
    msg: { type: 'cancel'; sessionId: string },
  ): void {
    this.logger.info('收到取消请求', { connectionId, sessionId: msg.sessionId });
    // TODO: 通过 AgentRegistry 取消对应 Agent 的运行
  }

  private handleFileStart(
    connectionId: string,
    msg: {
      type: 'file_start';
      sessionId: string;
      fileId: string;
      name: string;
      mime: string;
      totalSize: number;
      totalChunks: number;
    },
  ): void {
    this.sessions.bindSession(msg.sessionId, connectionId);
    const conn = this.sessions.getConnection(msg.sessionId);
    if (!conn) return;

    const buffer: DesktopFileBuffer = {
      fileId: msg.fileId,
      sessionId: msg.sessionId,
      name: msg.name,
      mime: msg.mime,
      totalChunks: msg.totalChunks,
      chunks: [],
      received: 0,
    };
    conn.fileBuffers.set(msg.fileId, buffer);
    this.logger.debug('文件传输开始', {
      fileId: msg.fileId,
      name: msg.name,
      totalChunks: msg.totalChunks,
    });
  }

  private handleFileEnd(
    connectionId: string,
    msg: { type: 'file_end'; sessionId: string; fileId: string },
  ): void {
    const conn = this.sessions.getConnection(msg.sessionId);
    if (!conn) return;

    const buffer = conn.fileBuffers.get(msg.fileId);
    if (!buffer) return;

    // 合并所有分片并保存到媒体目录
    const fileData = Buffer.concat(buffer.chunks);
    const mediaDir = path.join(
      this.options.context.paths.mediaDir,
      'desktop',
      sanitizePathSegment(buffer.sessionId),
    );
    mkdirSync(mediaDir, { recursive: true });

    const filePath = path.join(mediaDir, `${randomUUID()}-${sanitizeFileName(buffer.name)}`);
    writeFileSync(filePath, fileData);

    conn.completedFiles.set(msg.fileId, {
      fileId: msg.fileId,
      sessionId: buffer.sessionId,
      name: buffer.name,
      mime: buffer.mime,
      size: fileData.length,
      filePath,
    });

    this.logger.info('文件接收完成', {
      fileId: msg.fileId,
      name: buffer.name,
      path: filePath,
      size: fileData.length,
    });

    conn.fileBuffers.delete(msg.fileId);
  }

  private consumeChatAttachments(
    conn: DesktopConnection,
    sessionId: string,
    files: Array<{ fileId?: string; name: string; mime: string; size?: number }>,
  ): DesktopReceivedFile[] {
    const attachments: DesktopReceivedFile[] = [];
    for (const file of files) {
      if (!file.fileId) continue;
      const received = conn.completedFiles.get(file.fileId);
      if (received?.sessionId !== sessionId) continue;
      attachments.push(received);
      conn.completedFiles.delete(file.fileId);
    }
    return attachments;
  }

  private buildMessageComponents(
    text: string,
    attachments: DesktopReceivedFile[],
  ): MessageComponent[] {
    const components: MessageComponent[] = [];
    const trimmedText = text.trim();
    const attachmentText = formatAttachmentText(attachments);
    const plainText = [trimmedText, attachmentText].filter(Boolean).join('\n\n');
    if (plainText.length > 0) components.push({ type: 'Plain', text: plainText });

    for (const attachment of attachments) {
      components.push(fileToMessageComponent(attachment));
    }

    if (components.length === 0) components.push({ type: 'Plain', text: '' });
    return components;
  }

  private handleBinaryFrame(connectionId: string, data: Buffer): void {
    // 二进制帧来自最近 file_start 的活跃传输
    const conn = this.sessions.activeConnections.find((c) => c.id === connectionId);
    if (!conn || conn.fileBuffers.size === 0) return;

    // 取第一个活跃的传输
    const [buffer] = conn.fileBuffers.values();
    if (!buffer) return;
    if (buffer.received >= buffer.totalChunks) return;

    buffer.chunks.push(data);
    buffer.received++;

    if (buffer.received === buffer.totalChunks) {
      this.logger.debug('文件分片全部接收', { fileId: buffer.fileId });
    }
  }

  private startHeartbeat(): void {
    const interval = setInterval(() => {
      for (const conn of this.sessions.activeConnections) {
        conn.sendJson({ type: 'ping' } satisfies DesktopOutboundMessage);
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.wss?.on('close', () => clearInterval(interval));
  }
}
