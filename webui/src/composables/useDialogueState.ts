import { computed, onBeforeUnmount, onMounted, readonly, ref, watch, type ComputedRef } from 'vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import { useLatestRequestGuard } from '@/composables/useLatestRequestGuard';
import type { Session, SessionDetail, SessionMessage } from '@/lib/types';

export function useDialogueState(token: string | null, currentSessionKey: ComputedRef<string>) {
  const sessions = ref<Session[]>([]);
  const sessionsLoading = ref(false);
  const detailLoading = ref(false);
  const sending = ref(false);
  const deleting = ref(false);
  const detailError = ref('');
  const activeDetail = ref<SessionDetail | null>(null);
  const draftSessionKey = ref('');
  const sessionPreviews = ref<Record<string, string>>({});
  const detailRequestGuard = useLatestRequestGuard();
  let stopSessionsSubscription: (() => void) | null = null;
  let stopDetailSubscription: (() => void) | null = null;

  const displayMessages = computed<SessionMessage[]>(() => activeDetail.value?.messages || []);
  const visibleAgentFilters = computed(() => [...new Set(sessions.value.map((session) => session.agentName || 'main'))].slice(0, 6));
  const headerTitle = computed(() => activeDetail.value ? sessionTitle(activeDetail.value) : '新建对话');
  const contextWidth = computed(() => {
    const messages = activeDetail.value?.messageCount || 0;
    const percent = Math.min(92, Math.max(18, messages * 8));
    return `${percent}%`;
  });
  const contextLabel = computed(() => {
    const messages = activeDetail.value?.messageCount || 0;
    return `${Math.min(100, messages * 4)}% / 128k`;
  });
  const draftChannelLabel = computed(() => 'webui');
  const draftChatIdLabel = computed(() => draftSessionKey.value || '创建后生成');

  function sessionTitle(session: Pick<Session, 'key' | 'chatId' | 'channel'>) {
    return session.chatId || session.key.split(':')[1] || session.channel || '未命名会话';
  }

  function sessionStateLabel(session: Session) {
    if (currentSessionKey.value === session.key) return '当前';
    if (session.messageCount > 24) return '活跃';
    if (session.messageCount > 0) return '就绪';
    return '空白';
  }

  function sessionPreview(session: Session) {
    return sessionPreviews.value[session.key] || (session.messageCount > 0 ? '暂无消息预览' : '暂无消息');
  }

  function ensureDraftSessionKey() {
    if (!draftSessionKey.value) {
      draftSessionKey.value = `webui:${Date.now().toString(36)}`;
    }
    return draftSessionKey.value;
  }

  function resetDraftSessionKey() {
    draftSessionKey.value = '';
  }

  async function loadSessions() {
    sessionsLoading.value = true;
    const sessionsResult = await rpcCall<{ sessions: Session[] }>('sessions.list', token);
    sessions.value = sessionsResult.data?.sessions || [];
    sessionsLoading.value = false;
  }

  async function loadSessionDetail(key: string) {
    const requestId = detailRequestGuard.start();
    detailLoading.value = true;
    detailError.value = '';
    const result = await rpcCall<SessionDetail>('sessions.getDetail', token, { key });

    if (!detailRequestGuard.isCurrent(requestId)) {
      return;
    }

    if (result.error || !result.data) {
      activeDetail.value = null;
      detailError.value = result.error || '会话读取失败';
      detailLoading.value = false;
      return;
    }

    activeDetail.value = result.data;
    sessionPreviews.value = {
      ...sessionPreviews.value,
      [key]: result.data.messages[result.data.messages.length - 1]?.content || sessionPreviews.value[key] || '暂无消息预览'
    };
    detailLoading.value = false;
  }

  async function syncRouteSession() {
    if (!currentSessionKey.value) {
      detailRequestGuard.invalidate();
      activeDetail.value = null;
      detailError.value = '';
      detailLoading.value = false;
      return;
    }

    await loadSessionDetail(currentSessionKey.value);
  }

  function bindSessionsSubscription() {
    stopSessionsSubscription?.();
    stopSessionsSubscription = rpcSubscribe<{ sessions: Session[] }>(
      'sessions.list',
      token,
      undefined,
      (data) => {
        sessions.value = data.sessions;
        if (currentSessionKey.value && !data.sessions.some((session) => session.key === currentSessionKey.value)) {
          activeDetail.value = null;
          detailError.value = '会话已不存在';
          detailLoading.value = false;
        }
      }
    );
  }

  function bindDetailSubscription(sessionKey: string) {
    stopDetailSubscription?.();
    stopDetailSubscription = null;

    if (!sessionKey) {
      return;
    }

    stopDetailSubscription = rpcSubscribe<SessionDetail | null>(
      'sessions.detail',
      token,
      { key: sessionKey },
      (data) => {
        if (!data) {
          activeDetail.value = null;
          detailError.value = '会话已不存在';
          detailLoading.value = false;
          return;
        }

        activeDetail.value = data;
        detailError.value = '';
        detailLoading.value = false;
        sessionPreviews.value = {
          ...sessionPreviews.value,
          [sessionKey]: data.messages[data.messages.length - 1]?.content || sessionPreviews.value[sessionKey] || '暂无消息预览'
        };
      },
      {
        onError: (message) => {
          detailError.value = message;
          detailLoading.value = false;
        }
      }
    );
  }

  function stopSubscriptions() {
    stopSessionsSubscription?.();
    stopSessionsSubscription = null;
    stopDetailSubscription?.();
    stopDetailSubscription = null;
  }

  async function sendMessage(message: string) {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return { createdSessionKey: null };
    }

    const sessionKey = currentSessionKey.value || ensureDraftSessionKey();
    sending.value = true;
    detailError.value = '';

    const result = await rpcCall<{ success: true; response: string }>('chat.createResponse', token, {
      sessionKey,
      message: trimmedMessage,
      channel: 'webui',
      chatId: sessionKey.split(':')[1]
    });

    sending.value = false;

    if (result.error) {
      detailError.value = result.error;
      return { createdSessionKey: null };
    }

    return {
      createdSessionKey: currentSessionKey.value ? null : sessionKey
    };
  }

  async function deleteCurrentSession(sessionKey: string) {
    if (!sessionKey) {
      return false;
    }

    deleting.value = true;
    const result = await rpcCall<{ success: true }>('sessions.delete', token, { key: sessionKey });
    deleting.value = false;

    if (result.error) {
      detailError.value = result.error;
      return false;
    }

    resetDraftSessionKey();
    return true;
  }

  onMounted(async () => {
    await loadSessions();
    await syncRouteSession();
    bindSessionsSubscription();
    bindDetailSubscription(currentSessionKey.value);
  });

  watch(currentSessionKey, () => {
    void syncRouteSession();
    bindDetailSubscription(currentSessionKey.value);
  });

  onBeforeUnmount(() => {
    stopSubscriptions();
  });

  return {
    sessions: readonly(sessions),
    sessionsLoading: readonly(sessionsLoading),
    detailLoading: readonly(detailLoading),
    sending: readonly(sending),
    deleting: readonly(deleting),
    detailError: readonly(detailError),
    activeDetail: readonly(activeDetail),
    displayMessages,
    visibleAgentFilters,
    headerTitle,
    contextWidth,
    contextLabel,
    draftChannelLabel,
    draftChatIdLabel,
    sessionTitle,
    sessionStateLabel,
    sessionPreview,
    ensureDraftSessionKey,
    resetDraftSessionKey,
    sendMessage,
    deleteCurrentSession
  };
}
