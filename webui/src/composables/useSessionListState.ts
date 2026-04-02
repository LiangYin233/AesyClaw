import { computed, onBeforeUnmount, onMounted, readonly, ref, watch } from 'vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import { formatNumber } from '@/lib/format';
import { useLatestRequestGuard } from '@/composables/useLatestRequestGuard';
import type { Session, SessionDetail } from '@/lib/types';

export function useSessionListState(token: string | null) {
  const sessions = ref<Session[]>([]);
  const loading = ref(false);
  const deleting = ref(false);
  const error = ref('');
  const detail = ref<SessionDetail | null>(null);
  const detailLoading = ref(false);
  const detailError = ref('');
  const selectedKeys = ref<string[]>([]);
  const detailRequestGuard = useLatestRequestGuard();
  let stopSessionsSubscription: (() => void) | null = null;
  let stopDetailSubscription: (() => void) | null = null;

  const sortedSessions = computed(() => sessions.value);
  const selectedSet = computed(() => new Set(selectedKeys.value));
  const allSelected = computed(() => sortedSessions.value.length > 0 && sortedSessions.value.every((session) => selectedSet.value.has(session.key)));
  const totalMessages = computed(() => formatNumber(sessions.value.reduce((sum, session) => sum + session.messageCount, 0)));
  const averageMessageCount = computed(() => {
    if (!sessions.value.length) {
      return '0';
    }
    return (sessions.value.reduce((sum, session) => sum + session.messageCount, 0) / sessions.value.length).toFixed(1);
  });
  const webuiSessionCount = computed(() => formatNumber(sessions.value.filter((session) => session.channel === 'webui').length));
  const activeAgentCount = computed(() => formatNumber(new Set(sessions.value.map((session) => session.agentName || 'main')).size));
  const detailVisibleOnMobile = computed(() => detailLoading.value || Boolean(detail.value) || Boolean(detailError.value));

  async function loadSessionsPage() {
    loading.value = true;
    error.value = '';

    const sessionsResult = await rpcCall<{ sessions: Session[] }>('sessions.list', token);

    if (sessionsResult.error) {
      error.value = sessionsResult.error || '加载失败';
    }

    sessions.value = sessionsResult.data?.sessions || [];
    selectedKeys.value = selectedKeys.value.filter((key) => sessions.value.some((session) => session.key === key));

    if (detail.value && sessions.value.some((session) => session.key === detail.value?.key)) {
      await openSession(detail.value.key, false);
    } else if (detail.value) {
      closeDetail();
    }

    loading.value = false;
  }

  async function openSession(key: string, showLoading = true) {
    const requestId = detailRequestGuard.start();
    if (showLoading) {
      detailLoading.value = true;
    }
    detailError.value = '';

    const result = await rpcCall<SessionDetail>('sessions.getDetail', token, { key });
    if (!detailRequestGuard.isCurrent(requestId)) {
      return;
    }

    if (result.error || !result.data) {
      detail.value = null;
      detailError.value = result.error || '无法加载会话详情';
      detailLoading.value = false;
      return;
    }

    detail.value = result.data;
    detailLoading.value = false;
  }

  function closeDetail() {
    detailRequestGuard.invalidate();
    stopDetailSubscription?.();
    stopDetailSubscription = null;
    detail.value = null;
    detailError.value = '';
    detailLoading.value = false;
  }

  function bindSessionsSubscription() {
    stopSessionsSubscription?.();
    stopSessionsSubscription = rpcSubscribe<{ sessions: Session[] }>(
      'sessions.list',
      token,
      undefined,
      (data) => {
        sessions.value = data.sessions;
        selectedKeys.value = selectedKeys.value.filter((key) => data.sessions.some((session) => session.key === key));
        if (detail.value && !data.sessions.some((session) => session.key === detail.value?.key)) {
          closeDetail();
        }
        loading.value = false;
      },
      {
        onError: (message) => {
          error.value = message;
          loading.value = false;
        }
      }
    );
  }

  function bindDetailSubscription(sessionKey: string | null) {
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
          closeDetail();
          return;
        }

        detail.value = data;
        detailError.value = '';
        detailLoading.value = false;
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

  function channelDescription(channel?: string) {
    if (!channel) return '未标记渠道';
    if (channel === 'webui') return '来自新版 WebUI 对话入口';
    return `来自 ${channel} 渠道的会话上下文`;
  }

  function handleToggleSelection(key: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    selectedKeys.value = checked
      ? [...new Set([...selectedKeys.value, key])]
      : selectedKeys.value.filter((item) => item !== key);
  }

  function handleToggleAll(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    selectedKeys.value = checked ? sortedSessions.value.map((session) => session.key) : [];
  }

  async function deleteSingleSession(key: string) {
    if (!window.confirm(`确定要删除会话 "${key}" 吗？删除后无法恢复。`)) {
      return;
    }

    deleting.value = true;
    const result = await rpcCall<{ success: true }>('sessions.delete', token, { key });
    deleting.value = false;

    if (result.error) {
      error.value = result.error;
      return;
    }

    if (detail.value?.key === key) {
      closeDetail();
    }

    selectedKeys.value = selectedKeys.value.filter((item) => item !== key);
  }

  async function deleteSelectedSessions() {
    if (!selectedKeys.value.length) {
      return;
    }

    if (!window.confirm(`确认删除已选的 ${selectedKeys.value.length} 个会话吗？此操作无法撤销。`)) {
      return;
    }

    deleting.value = true;
    const results = await Promise.all(selectedKeys.value.map((key) => rpcCall<{ success: true }>('sessions.delete', token, { key })));
    deleting.value = false;

    const failed = results.find((result) => result.error);
    error.value = failed?.error || '';
    closeDetail();
    selectedKeys.value = [];
  }

  function handleDeleteDetailSession() {
    if (detail.value?.key) {
      void deleteSingleSession(detail.value.key);
    }
  }

  onMounted(() => {
    void loadSessionsPage();
    bindSessionsSubscription();
  });

  watch(() => detail.value?.key || null, (sessionKey) => {
    bindDetailSubscription(sessionKey);
  });

  onBeforeUnmount(() => {
    stopSubscriptions();
  });

  return {
    sessions: readonly(sessions),
    loading: readonly(loading),
    deleting: readonly(deleting),
    error: readonly(error),
    detail: readonly(detail),
    detailLoading: readonly(detailLoading),
    detailError: readonly(detailError),
    selectedKeys: readonly(selectedKeys),
    sortedSessions,
    selectedSet,
    allSelected,
    totalMessages,
    averageMessageCount,
    webuiSessionCount,
    activeAgentCount,
    detailVisibleOnMobile,
    openSession,
    closeDetail,
    channelDescription,
    handleToggleSelection,
    handleToggleAll,
    deleteSingleSession,
    deleteSelectedSessions,
    handleDeleteDetailSession
  };
}
