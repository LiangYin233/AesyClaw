/** useChat composable — 聊天状态管理（重构后的主入口）。
 *
 * 整合所有子 composables，提供统一的聊天管理接口。
 */

import type { ChatMessageEvent, DesktopUploadFile } from '../../preload/index';
import { useWebSocket } from './useWebSocket';
import { useMessages } from './useMessages';
import { useSessions } from './useSessions';
import { useChatActions } from './useChatActions';

export type { ChatSession, ChatMessage, UserMessage, AssistantMessage, ToolMessage, ChatAttachment, MediaItem, ToolCallState } from '../types/chat';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useChat() {
  const { handleChannelResponse: handleWSResponse } = useWebSocket();
  const { handleStreamEvent: handleMessageStreamEvent } = useMessages();
  const {
    sessions,
    activeSessionId,
    activeSession,
    createSession,
    syncSessionsFromBackend,
    loadSessionMessages,
    reloadSessionMessages,
    removeSessionLocally,
  } = useSessions();
  const { sendMessage: sendMsg, checkDeleteConfirmation, markDeleteConfirmed } = useChatActions();

  /** 处理来自 chat WebSocket 的响应事件 */
  function handleChannelResponse(
    type: string,
    sessionId: string | undefined,
    data: unknown,
  ): void {
    const resolved = handleWSResponse(type, sessionId, data);
    if (!resolved) {
      // 无等待请求时，触发被动同步（如 compact 后自动刷新 / WS 重连）
      if (type === 'sessions') {
        void syncSessionsFromBackend().then(() => {
          // WS 重连后首次收到 sessions 时，补充加载当前会话消息
          if (activeSessionId.value !== null) {
            const session = sessions.value.find((s) => s.id === activeSessionId.value);
            if (session !== undefined && !session.streaming && session.messages.length === 0) {
              void loadSessionMessages(activeSessionId.value, true);
            }
          }
        });
      }
    }
  }

  /** 处理流式事件 */
  function handleStreamEvent(event: ChatMessageEvent): void {
    const session = sessions.value.find((s) => s.id === event.sessionId);
    if (!session) return;

    handleMessageStreamEvent(event, session, (sessionId: string) => {
      markDeleteConfirmed(sessionId);
    });

    // 处理 done 事件后的删除确认
    if (event.type === 'done') {
      if (checkDeleteConfirmation(session.id)) {
        removeSessionLocally(session.id);
      }
    }
  }

  /** 发送消息 */
  async function sendMessage(text: string, files: DesktopUploadFile[] = []): Promise<void> {
    let sessionId = activeSessionId.value;
    sessionId ??= createSession();

    const session = sessions.value.find((s) => s.id === sessionId);
    if (session === undefined) return;

    await sendMsg(session, text, files);
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    createSession,
    syncSessionsFromBackend,
    loadSessionMessages,
    reloadSessionMessages,
    sendMessage,
    handleChannelResponse,
    handleStreamEvent,
  };
}
