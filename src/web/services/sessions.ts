/** 会话 Service。 */

import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';

/**
 * 获取所有会话列表。
 */
export async function getSessions(deps: WebUiManagerDependencies): Promise<unknown> {
  const sessions = await deps.databaseManager.sessions.findAll();
  return sessions;
}

/**
 * 获取指定会话的消息历史。
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
