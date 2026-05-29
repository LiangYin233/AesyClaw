/**
 * desktop-server — Desktop 频道协议层。
 *
 * 负责消息协议处理：聊天、取消、文件传输、流式转发。
 * WebSocket 传输层委托给 WsServer。
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import nodePath from 'node:path';
import { createScopedLogger } from '@aesyclaw/sdk';
import * as desktopAttachments from './attachments';
import type { DesktopConnection, DesktopSessionManager } from './session-manager';
import { WsServer } from './ws-server';
import type {
  DesktopInboundMessage,
  DesktopOutboundMessage,
  DesktopFileBuffer,
  DesktopReceivedFile,
} from './types';
import type { ChannelContext, MessageComponent, OutboundSignal } from '@aesyclaw/sdk';

export type DesktopServerOptions = {
  port: number;
  host?: string;
  authToken: string;
  adminToken: string;
  context: ChannelContext;
};

export class DesktopServer {
  private wsServer: WsServer;
  private options: DesktopServerOptions;
  private logger = createScopedLogger('channel:desktop:server');

  constructor(options: DesktopServerOptions) {
    this.options = options;
    this.wsServer = new WsServer({
      port: options.port,
      host: options.host,
      authToken: options.authToken,
      adminToken: options.adminToken,
      getCommands: () => {
        return options.context.getCommands().map((cmd) => ({
          name: cmd.namespace ? `${cmd.namespace} ${cmd.name}` : cmd.name,
          description: cmd.description ?? '',
        }));
      },
      onJsonMessage: (cid, raw) => this.handleJsonMessage(cid, raw),
      onBinaryFrame: (cid, data) => this.handleBinaryFrame(cid, data),
    });
  }

  get sessions(): DesktopSessionManager {
    return this.wsServer.sessions;
  }

  async start(): Promise<void> {
    await this.wsServer.start();
  }

  async stop(): Promise<void> {
    await this.wsServer.stop();
  }

  /** 向指定 session 的所有连接发送下行消息 */
  sendToSession(sessionId: string, message: DesktopOutboundMessage): void {
    const conn = this.sessions.getConnection(sessionId);
    if (!conn) return;
    conn.sendJson(message);
  }

  /** 处理来自 AesyClaw 内部的出站信号，转换为下行消息发送 */
  forwardStreamEvent(sessionId: string, signal: OutboundSignal): void {
    const conn = this.sessions.getConnection(sessionId);
    if (!conn) return;

    switch (signal.kind) {
      case 'chunk':
        conn.sendJson({
          type: 'chunk',
          sessionId,
          text: signal.text,
          index: signal.index,
        } satisfies DesktopOutboundMessage);
        break;
      case 'toolCall':
        conn.sendJson({
          type: 'tool_call',
          sessionId,
          toolCallId: signal.toolCallId,
          toolName: signal.toolName,
          args: signal.args,
        } satisfies DesktopOutboundMessage);
        break;
      case 'toolResult':
        conn.sendJson({
          type: 'tool_result',
          sessionId,
          toolCallId: signal.toolCallId,
          toolName: signal.toolName,
          result: signal.result,
          isError: signal.isError,
        } satisfies DesktopOutboundMessage);
        break;
      case 'done':
        conn.sendJson({
          type: 'done',
          sessionId,
          usage: signal.usage,
        } satisfies DesktopOutboundMessage);
        break;
      case 'error':
        conn.sendJson({
          type: 'error',
          sessionId,
          message: signal.message,
        } satisfies DesktopOutboundMessage);
        break;
      case 'message':
        // message 不在 forwardStreamEvent 中处理，由 index.ts 的 send() 直接处理
        break;
    }
  }

  // ─── 消息路由 ──────────────────────────────────────────────────

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
        void this.handleCancelMessage(connectionId, msg);
        break;
      case 'get_sessions':
        void this.handleGetSessions(connectionId, msg);
        break;
      case 'get_session_messages':
        void this.handleGetSessionMessages(connectionId, msg);
        break;
      case 'get_context_usage':
        void this.handleGetContextUsage(connectionId, msg);
        break;
      case 'file_start':
        this.handleFileStart(connectionId, msg);
        break;
      case 'file_end':
        this.handleFileEnd(connectionId, msg);
        break;
      case 'pong':
        break;
      default:
        this.logger.warn('未知消息类型', {
          connectionId,
          type: (msg as Record<string, unknown>)['type'],
        });
    }
  }

  // ─── 业务处理 ──────────────────────────────────────────────────

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
    const message = { components: this.buildMessageComponents(msg.text, attachments) };

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

  private async handleCancelMessage(
    connectionId: string,
    msg: { type: 'cancel'; sessionId: string },
  ): Promise<void> {
    this.logger.info('收到取消请求', { connectionId, sessionId: msg.sessionId });
    const sessionKey = this.sessions.makeSessionKey(msg.sessionId);
    const conn = this.sessions.getConnection(msg.sessionId);
    try {
      await this.options.context.receive(
        { components: [{ type: 'Plain', text: '/stop' }] },
        sessionKey,
        { id: connectionId, name: `Desktop-${connectionId.slice(0, 8)}` },
      );
    } catch (err) {
      this.logger.error('取消 Agent 处理失败', { connectionId, sessionId: msg.sessionId }, err);
      conn?.sendJson({
        type: 'error',
        sessionId: msg.sessionId,
        message: err instanceof Error ? err.message : '取消 Agent 处理失败',
      } satisfies DesktopOutboundMessage);
    }
  }

  private async handleGetContextUsage(
    connectionId: string,
    msg: { type: 'get_context_usage'; sessionId: string },
  ): Promise<void> {
    const sessionKey = this.sessions.makeSessionKey(msg.sessionId);
    try {
      const usage = await this.options.context.getSessionContextUsage(sessionKey);
      const conn = this.sessions.getConnectionById(connectionId);
      if (conn) {
        conn.sendJson({
          type: 'context_usage',
          sessionId: msg.sessionId,
          estimatedTokens: usage.estimatedTokens,
          contextWindow: usage.contextWindow,
          percentage: usage.percentage,
        } satisfies DesktopOutboundMessage);
      }
    } catch {
      this.logger.warn('获取会话上下文使用率失败', { sessionId: msg.sessionId });
    }
  }

  private async handleGetSessions(
    _connectionId: string,
    _msg: { type: 'get_sessions' },
  ): Promise<void> {
    try {
      const sessions = await this.options.context.getSessions();
      // 广播给所有连接（只有一个 Desktop 客户端）
      for (const conn of this.wsServer.sessions.activeConnections) {
        conn.sendJson({ type: 'sessions', data: sessions });
      }
    } catch {
      this.logger.warn('获取会话列表失败');
    }
  }

  private async handleGetSessionMessages(
    connectionId: string,
    msg: { type: 'get_session_messages'; sessionId: string },
  ): Promise<void> {
    try {
      const sessionKey = this.sessions.makeSessionKey(msg.sessionId);
      const messages = await this.options.context.getSessionMessages(sessionKey);
      const conn = this.sessions.getConnectionById(connectionId);
      if (conn) {
        conn.sendJson({ type: 'session_messages', sessionId: msg.sessionId, data: messages });
      }
    } catch {
      this.logger.warn('获取会话消息失败', { sessionId: msg.sessionId });
    }
  }

  // ─── 文件传输 ──────────────────────────────────────────────────

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
    _connectionId: string,
    msg: { type: 'file_end'; sessionId: string; fileId: string },
  ): void {
    const conn = this.sessions.getConnection(msg.sessionId);
    if (!conn) return;

    const buffer = conn.fileBuffers.get(msg.fileId);
    if (!buffer) return;

    const fileData = Buffer.concat(buffer.chunks);
    const baseMediaDir = this.options.context.paths.mediaDir;
    const mediaDir = nodePath.join(
      baseMediaDir,
      'desktop',
      desktopAttachments.sanitizePathSegment(buffer.sessionId),
    );
    mkdirSync(mediaDir, { recursive: true });

    const targetFile = nodePath.join(
      mediaDir,
      `${randomUUID()}-${desktopAttachments.sanitizeFileName(buffer.name)}`,
    );
    writeFileSync(targetFile, fileData);

    conn.completedFiles.set(msg.fileId, {
      fileId: msg.fileId,
      sessionId: buffer.sessionId,
      name: buffer.name,
      mime: buffer.mime,
      size: fileData.length,
      filePath: targetFile,
    });

    this.logger.info('文件接收完成', {
      fileId: msg.fileId,
      name: buffer.name,
      path: targetFile,
      size: fileData.length,
    });

    conn.fileBuffers.delete(msg.fileId);
  }

  // ─── 附件构建 ──────────────────────────────────────────────────

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
    const attachmentText = desktopAttachments.formatAttachmentText(attachments);
    const plainText = [trimmedText, attachmentText].filter(Boolean).join('\n\n');
    if (plainText.length > 0) components.push({ type: 'Plain', text: plainText });

    for (const attachment of attachments) {
      components.push(desktopAttachments.fileToMessageComponent(attachment));
    }

    if (components.length === 0) components.push({ type: 'Plain', text: '' });
    return components;
  }

  private handleBinaryFrame(connectionId: string, data: Buffer): void {
    const conn = this.sessions.activeConnections.find((c) => c.id === connectionId);
    if (!conn || conn.fileBuffers.size === 0) return;

    const [buffer] = conn.fileBuffers.values();
    if (!buffer) return;
    if (buffer.received >= buffer.totalChunks) return;

    buffer.chunks.push(data);
    buffer.received++;

    if (buffer.received === buffer.totalChunks) {
      this.logger.debug('文件分片全部接收', { fileId: buffer.fileId });
    }
  }
}
