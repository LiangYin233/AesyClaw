/** 会话 Service。 */

import type { WebRuntimeDependencies } from '@aesyclaw/web/types';

function makeSessionTitle(text: string, fallback: string): string {
  const source = text.length > 0 ? text : fallback;
  return source.slice(0, 30);
}

/**
 * 获取所有会话列表。
 *
 * @param deps - WebUI 管理器依赖项
 * @returns 会话列表
 */
export async function getSessions(deps: WebRuntimeDependencies): Promise<unknown> {
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
  deps: WebRuntimeDependencies,
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
 * @throws 会话未找到或已锁定时抛出
 */
export async function clearSessionHistory(
  deps: WebRuntimeDependencies,
  sessionId: string,
): Promise<void> {
  const sessionRecord = await deps.databaseManager.sessions.findById(sessionId);
  if (!sessionRecord) {
    throw new Error('会话未找到');
  }

  const sessionKey = {
    channel: sessionRecord.channel,
    type: sessionRecord.type,
    chatId: sessionRecord.chatId,
  };

  // 先检查锁：会话正在被 Agent 处理时不允许清除
  if (deps.sessionManager.isLocked(sessionKey)) {
    throw new Error('会话正在处理中，无法清除历史');
  }

  await deps.databaseManager.messages.clearHistory(sessionId);
  await deps.sessionManager.clear(sessionKey);
}

/**
 * 获取指定会话的上下文窗口使用率。
 */
export async function getSessionContext(
  deps: WebRuntimeDependencies,
  sessionId: string,
): Promise<{ estimatedTokens: number; contextWindow: number; percentage: number }> {
  const sessionRecord = await deps.databaseManager.sessions.findById(sessionId);
  if (!sessionRecord) throw new Error('会话未找到');

  // 通过角色获取 modelId
  const boundRoleId = await deps.databaseManager.roleBindings.getActiveRole(sessionId);
  const role = boundRoleId ? deps.roleManager.getRole(boundRoleId) : undefined;
  const modelId = role?.model ?? deps.roleManager.getDefaultRole()?.model;
  const contextWindow = modelId ? deps.llmAdapter.resolveModel(modelId).contextWindow : 128_000;

  // 估算 token：直接用 content 文本长度 / 3.5
  const messages = await deps.databaseManager.messages.loadHistory(sessionId);
  let charCount = 0;
  for (const msg of messages) {
    charCount += msg.content.length;
    if (msg.toolData) {
      // 粗略估计 tool_data JSON 长度
      charCount += msg.toolData.length;
    }
  }
  const estimatedTokens = Math.ceil(charCount / 3.5);

  return {
    estimatedTokens,
    contextWindow,
    percentage: contextWindow > 0 ? Math.round((estimatedTokens / contextWindow) * 10000) / 100 : 0,
  };
}
