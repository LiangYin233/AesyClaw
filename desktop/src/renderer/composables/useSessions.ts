/** useSessions composable — 会话管理。
 *
 * 负责会话的创建、同步、加载和管理。
 */

import { ref, computed } from 'vue';
import { makeSessionTitle } from '../utils/title';
import type { DesktopSessionSummary, DesktopHistoryMessage } from '../../preload/index';
import type { ChatSession } from '../types/chat';
import { useWebSocket } from './useWebSocket';
import { useMessages } from './useMessages';

export function useSessions() {
  const sessions = ref<ChatSession[]>([]);
  const activeSessionId = ref<string | null>(null);
  const lastBackendSummaries = new Map<string, DesktopSessionSummary>();

  const { channelRequest } = useWebSocket();
  const { buildMessagesFromHistory } = useMessages();

  const activeSession = computed(
    (): ChatSession | null => sessions.value.find((s) => s.id === activeSessionId.value) ?? null,
  );

  function createSession(): string {
    const id = `desktop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessions.value.push(createEmptySession(id, '新对话'));
    activeSessionId.value = id;
    return id;
  }

  async function syncSessionsFromBackend(): Promise<void> {
    const raw = await channelRequest('get_sessions');
    if (!Array.isArray(raw)) return;
    const summaries = (raw as DesktopSessionSummary[]).filter(
      (session) => session.channel === 'desktop',
    );
    lastBackendSummaries.clear();
    for (const summary of summaries) {
      lastBackendSummaries.set(summary.chatId, summary);
    }
    const existing = new Map(sessions.value.map((session) => [session.id, session]));
    const synced: ChatSession[] = [];

    for (const summary of summaries) {
      const local =
        existing.get(summary.chatId) ??
        createEmptySession(summary.chatId, getSessionTitle(summary));
      // 仅当后端摘要含有实际消息内容时才覆盖本地标题，
      // 避免空会话的标题被回退为 desktop-xxx
      if (summary.firstUserMessage) {
        local.title = getSessionTitle(summary);
      }
      synced.push(local);
      existing.delete(summary.chatId);
    }

    for (const local of existing.values()) {
      if (shouldKeepLocalSession(local)) {
        synced.push(local);
      }
    }

    sessions.value = synced;
    if (
      activeSessionId.value &&
      !sessions.value.some((session) => session.id === activeSessionId.value)
    ) {
      activeSessionId.value = sessions.value[0]?.id ?? null;
    } else {
      activeSessionId.value ??= sessions.value[0]?.id ?? null;
    }
  }

  async function loadSessionMessages(sessionId: string, force = false): Promise<void> {
    const session = sessions.value.find((item) => item.id === sessionId);
    if (!session || session.streaming) return;
    if (!force && session.messages.length > 0) return;
    const summary = findBackendSummary(sessionId);
    if (!summary) return;
    session.isLoading = true;
    const raw = (await channelRequest('get_session_messages', {
      sessionId,
    })) as DesktopHistoryMessage[];
    session.isLoading = false;
    if (!Array.isArray(raw)) return;

    session.messages = buildMessagesFromHistory(raw);
    session.activeAssistantMessage = null;
  }

  /** 强制重新加载指定会话的消息（清空缓存后从后端拉取） */
  async function reloadSessionMessages(sessionId: string): Promise<void> {
    const session = sessions.value.find((item) => item.id === sessionId);
    if (!session) return;
    session.messages = [];
    await loadSessionMessages(sessionId, true);
  }

  function removeSessionLocally(sessionId: string): void {
    sessions.value = sessions.value.filter((session) => session.id !== sessionId);
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value[0]?.id ?? null;
    }
  }

  function createEmptySession(id: string, title: string): ChatSession {
    return {
      id,
      title,
      messages: [],
      streaming: false,
      pendingToolCalls: new Map(),
      activeAssistantMessage: null,
      isLoading: false,
    };
  }

  function getSessionTitle(summary: DesktopSessionSummary): string {
    return makeSessionTitle(
      summary.firstUserMessage ?? summary.title ?? summary.chatId ?? summary.id,
      summary.chatId ?? summary.id,
    );
  }

  function findBackendSummary(chatId: string): DesktopSessionSummary | null {
    return lastBackendSummaries.get(chatId) ?? null;
  }

  function shouldKeepLocalSession(session: ChatSession): boolean {
    return session.streaming || session.messages.length > 0 || session.id === activeSessionId.value;
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    createSession,
    syncSessionsFromBackend,
    loadSessionMessages,
    reloadSessionMessages,
    removeSessionLocally,
  };
}
