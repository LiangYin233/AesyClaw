/** 连接 → Session 映射管理器。
 *
 * 管理 WebSocket 连接与会话（SessionKey）的映射关系。
 * 一个连接可承载多个会话，每条消息携带 sessionId 标识目标会话。
 */

import type { SessionKey } from '@aesyclaw/sdk';
import type { DesktopFileBuffer, DesktopReceivedFile } from './types';

export type DesktopConnection = {
  /** 连接 ID（uuid） */
  id: string;
  /** 发送函数 */
  sendJson(data: unknown): void;
  /** 发送二进制帧 */
  sendBinary(data: Buffer): void;
  /** 关闭连接 */
  close(code?: number, reason?: string): void;
  /** 活跃的会话 ID 集合 */
  sessions: Set<string>;
  /** 当前正在进行的文件传输缓冲区 */
  fileBuffers: Map<string, DesktopFileBuffer>;
  /** 已完成并等待随聊天消息消费的文件 */
  completedFiles: Map<string, DesktopReceivedFile>;
  /** 正在异步落盘、等待完成后才能随聊天消息消费的文件 */
  pendingFiles: Map<string, Promise<void>>;
};

export class DesktopSessionManager {
  /** 连接 ID → 连接对象 */
  private connections = new Map<string, DesktopConnection>();
  /** sessionId → 连接 ID */
  private sessionToConnection = new Map<string, string>();

  /** 注册新连接 */
  register(connection: DesktopConnection): void {
    this.connections.set(connection.id, connection);
  }

  /** 移除连接，并清理其所有会话映射 */
  unregister(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (conn) {
      for (const sessionId of conn.sessions) {
        this.sessionToConnection.delete(sessionId);
      }
      this.connections.delete(connectionId);
    }
  }

  /** 将 sessionId 关联到指定连接 */
  bindSession(sessionId: string, connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    conn.sessions.add(sessionId);
    this.sessionToConnection.set(sessionId, connectionId);
  }

  /** 根据 sessionId 查找对应的连接 */
  getConnection(sessionId: string): DesktopConnection | undefined {
    const connectionId = this.sessionToConnection.get(sessionId);
    if (!connectionId) return undefined;
    return this.connections.get(connectionId);
  }

  /** 根据连接 ID 查找连接 */
  getConnectionById(connectionId: string): DesktopConnection | undefined {
    return this.connections.get(connectionId);
  }

  /** 所有活跃连接 */
  get activeConnections(): DesktopConnection[] {
    return [...this.connections.values()];
  }

  /** 活跃连接数 */
  get connectionCount(): number {
    return this.connections.size;
  }

  /** 构建 SessionKey */
  makeSessionKey(sessionId: string): SessionKey {
    return {
      channel: 'desktop',
      type: 'private',
      chatId: sessionId,
    };
  }
}
