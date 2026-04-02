import { computed, onBeforeUnmount, onMounted, readonly, ref, watch } from 'vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import type { MemoryConversationItem, MemoryOperation } from '@/lib/types';

export function useMemoryState(token: string | null) {
  const items = ref<MemoryConversationItem[]>([]);
  const loading = ref(false);
  const deleting = ref(false);
  const error = ref('');
  const activeTab = ref<'summary' | 'facts'>('summary');
  const selectedKey = ref('');
  let stopMemorySubscription: (() => void) | null = null;

  const filteredItems = computed(() => items.value.filter((item) => (
    activeTab.value === 'summary'
      ? Boolean(item.summaryCount || item.conversationSummary || item.sessions.some((session) => session.summary))
      : item.entries.length > 0
  )));
  const selectedItem = computed(() => filteredItems.value.find((item) => item.key === selectedKey.value) || filteredItems.value[0] || null);
  const selectedEntries = computed(() => [...(selectedItem.value?.entries || [])].sort((left, right) => right.confidence - left.confidence));
  const selectedOperations = computed<MemoryOperation[]>(() => (selectedItem.value?.recentOperations || []).slice(0, 12));
  const totalFacts = computed(() => items.value.reduce((sum, item) => sum + item.entries.length, 0));
  const totalSummaries = computed(() => items.value.reduce((sum, item) => sum + item.summaryCount, 0));
  const totalSessions = computed(() => items.value.reduce((sum, item) => sum + item.sessionCount, 0));
  const totalOperations = computed(() => items.value.reduce((sum, item) => sum + item.recentOperations.length, 0));
  const latestSessionKey = computed(() => selectedItem.value?.sessions[0]?.sessionKey || '');

  function memoryPreview(item: MemoryConversationItem) {
    return item.conversationSummary
      || item.sessions.find((session) => session.summary)?.summary
      || '暂无摘要。';
  }

  function factPreview(item: MemoryConversationItem) {
    return item.entries[0]?.content || '当前会话还没有长期事实。';
  }

  async function clearSelected() {
    if (!selectedItem.value || !window.confirm(`确认清空 ${selectedItem.value.chatId || selectedItem.value.key} 的全部记忆吗？`)) {
      return;
    }

    deleting.value = true;
    const result = await rpcCall<{ success: true }>('memory.deleteOne', token, { key: selectedItem.value.key });
    deleting.value = false;

    if (result.error) {
      error.value = result.error;
    }
  }

  async function clearAll() {
    if (!items.value.length || !window.confirm('确认清空全部会话摘要和长期记忆吗？这个操作不可撤销。')) {
      return;
    }

    deleting.value = true;
    const result = await rpcCall<{ success: true }>('memory.deleteAll', token);
    deleting.value = false;

    if (result.error) {
      error.value = result.error;
    }
  }

  function bindSubscription() {
    stopMemorySubscription?.();
    loading.value = true;
    stopMemorySubscription = rpcSubscribe<{ items: MemoryConversationItem[] }>(
      'memory.list',
      token,
      undefined,
      (data) => {
        items.value = data.items;
        loading.value = false;
        error.value = '';
      },
      {
        onError: (message) => {
          error.value = message;
          loading.value = false;
        }
      }
    );
  }

  watch(filteredItems, (nextItems) => {
    if (!nextItems.length) {
      selectedKey.value = '';
      return;
    }

    if (!nextItems.some((item) => item.key === selectedKey.value)) {
      selectedKey.value = nextItems[0].key;
    }
  }, { immediate: true });

  onMounted(() => {
    bindSubscription();
  });

  onBeforeUnmount(() => {
    stopMemorySubscription?.();
    stopMemorySubscription = null;
  });

  return {
    items: readonly(items),
    loading: readonly(loading),
    deleting: readonly(deleting),
    error: readonly(error),
    activeTab,
    selectedKey,
    filteredItems,
    selectedItem,
    selectedEntries,
    selectedOperations,
    totalFacts,
    totalSummaries,
    totalSessions,
    totalOperations,
    latestSessionKey,
    memoryPreview,
    factPreview,
    clearSelected,
    clearAll
  };
}
