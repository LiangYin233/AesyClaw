/** 会话 Service。 */

import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';

const INFORMATION_TAG_RE = /<information\b[^>]*>[\s\S]*?<\/information>/gi;

function makeSessionTitle(text: string, fallback: string): string {
  const cleaned = text.replace(INFORMATION_TAG_RE, '').replace(/\s+/g, ' ').trim();
  const source = cleaned.length > 0 ? cleaned : fallback;
  return source.slice(0, 30);
}

/**
 * 获取所有会话列表。
 *
 * @param deps - WebUI 管理器依赖项
 * @returns 会话列表
 */
export async function getSessions(deps: WebUiManagerDependencies): Promise<unknown> {
  const sessions = await deps.databaseManager.sessions.findAllSummaries();
  return sessions.map((session) => ({
    ...session,
    title: makeSessionTitle(session.firstUserMessage ?? '', session.chatId),
  }));
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
  deps: WebUiManagerDependencies,
  sessionId: string,
): Promise<unknown> {
  const session = await deps.databaseManager.sessions.findById(sessionId);
  if (!session) {
    throw new Error('会话未找到');
  }
  const messages = await deps.databaseManager.messages.loadHistory(sessionId);
  return messages;
}

/**
 * 清空指定会话的消息历史。
 *
 * @param deps - WebUI 管理器依赖项
 * @param sessionId - 会话 ID
 * @throws 会话未找到时抛出
 */
export async function clearSessionHistory(
  deps: WebUiManagerDependencies,
  sessionId: string,
): Promise<void> {
  const session = await deps.databaseManager.sessions.findById(sessionId);
  if (!session) {
    throw new Error('会话未找到');
  }
  await deps.databaseManager.messages.clearHistory(sessionId);
  await deps.sessionManager.clear({
    channel: session.channel,
    type: session.type,
    chatId: session.chatId,
  });
}
