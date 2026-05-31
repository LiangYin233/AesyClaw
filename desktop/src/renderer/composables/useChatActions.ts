/** useChatActions composable — 聊天操作。
 *
 * 负责发送消息、处理错误、删除会话等操作。
 */

import { makeSessionTitle } from '../utils/title';
import type { DesktopUploadFile } from '../../preload/index';
import type { ChatSession, ChatAttachment } from '../types/chat';

export function useChatActions() {
  const pendingDeletedSessions = new Map<string, { confirmed: boolean }>();

  async function sendMessage(
    session: ChatSession,
    text: string,
    files: DesktopUploadFile[] = [],
    attachments: ChatAttachment[] = files.map(({ name, mime, size }) => ({ name, mime, size })),
  ): Promise<void> {
    if (text.trim().length === 0 && files.length === 0) return;

    const outboundSessionId = session.id;
    const trimmedText = text.trim();
    const titleText = trimmedText.length > 0 ? trimmedText : (attachments[0]?.name ?? '新对话');

    // 添加用户消息
    session.messages.push({ role: 'user', text, attachments });
    session.title = makeSessionTitle(titleText, '新对话');
    session.streaming = true;
    session.pendingToolCalls = new Map();
    session.activeAssistantMessage = null;
    if (isClearDeleteCommand(trimmedText)) {
      pendingDeletedSessions.set(outboundSessionId, { confirmed: false });
    }

    try {
      const sent = await window.aesyclaw.sendChat(outboundSessionId, text, files);
      if (!sent) {
        markSendFailure(session, '消息发送失败：聊天连接未建立');
        pendingDeletedSessions.delete(outboundSessionId);
      }
    } catch (error) {
      markSendFailure(session, `消息发送失败：${formatErrorMessage(error)}`);
      pendingDeletedSessions.delete(outboundSessionId);
    }
  }

  function markSendFailure(session: ChatSession, message: string): void {
    session.streaming = false;
    session.pendingToolCalls = new Map();
    if (session.activeAssistantMessage) {
      session.activeAssistantMessage.streaming = false;
    }
    session.activeAssistantMessage = null;
    session.messages.push({ role: 'system', text: message });
  }

  function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function isClearDeleteCommand(text: string): boolean {
    return /^\/clear\s+delete\s*$/i.test(text);
  }

  function checkDeleteConfirmation(sessionId: string): boolean {
    const pendingDelete = pendingDeletedSessions.get(sessionId);
    if (pendingDelete?.confirmed) {
      pendingDeletedSessions.delete(sessionId);
      return true;
    }
    return false;
  }

  function markDeleteConfirmed(sessionId: string): void {
    const pendingDelete = pendingDeletedSessions.get(sessionId);
    if (pendingDelete) {
      pendingDelete.confirmed = true;
    }
  }

  return {
    sendMessage,
    markSendFailure,
    checkDeleteConfirmation,
    markDeleteConfirmed,
  };
}
