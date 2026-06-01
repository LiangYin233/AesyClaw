/** 会话 Service。 */

import {
  toSessionMessageDto,
  type SessionMessageDto,
  type SessionSummary,
} from '@aesyclaw/session';
import type { WebRuntimeDependencies } from '@aesyclaw/web/types';
import type { SessionKey } from '@aesyclaw/core/types';

/**
 * 获取所有会话列表。
 *
 * @param deps - WebUI 管理器依赖项
 * @returns 会话列表
 */
export async function getSessions(deps: WebRuntimeDependencies): Promise<SessionSummary[]> {
  return await deps.sessionManager.getSummaries();
}

/**
 * 获取指定会话的消息历史。
 *
 * @param deps - WebUI 管理器依赖项
 * @param sessionId - 会话 ID
 * @returns 消息历史列表
 * @throws 会话未找到时抛出
 */
export async function getSessionMessages(
  deps: WebRuntimeDependencies,
  sessionId: string,
): Promise<SessionMessageDto[]> {
  const messages = await deps.sessionManager.getMessagesById(sessionId);
  return toSessionMessageDto(messages);
}

/**
 * 清空指定会话的消息历史。
 *
 * @param deps - WebUI 管理器依赖项
 * @param sessionId - 会话 ID
 * @throws 会话未找到或已锁定时抛出
 */
export async function clearSessionHistory(
  deps: WebRuntimeDependencies,
  sessionId: string,
): Promise<void> {
  const record = await deps.databaseManager.sessions.findById(sessionId);
  await deps.sessionManager.clearById(sessionId);
  if (record !== null) {
    deps.agentRegistry.unregisterAgent(toSessionKey(record));
  }
}

function toSessionKey(record: { channel: string; type: string; chatId: string }): SessionKey {
  return { channel: record.channel, type: record.type, chatId: record.chatId };
}
