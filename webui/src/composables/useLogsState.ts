import { computed, onBeforeUnmount, onMounted, readonly, ref, watch } from 'vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import type { LogLevel, ObservabilityEntriesResponse, ObservabilityLogEntry, ObservabilityLoggingConfig, TokenUsageStats } from '@/lib/types';

export function useLogsState(token: string | null) {
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const config = ref<ObservabilityLoggingConfig | null>(null);
  const entries = ref<ObservabilityLogEntry[]>([]);
  const usageStats = ref<TokenUsageStats | null>(null);
  const bufferTotal = ref(0);
  const loading = ref(false);
  const savingLevel = ref(false);
  const error = ref('');
  const levelFilter = ref<'all' | LogLevel>('all');
  const levelDraft = ref<LogLevel>('info');
  const limit = ref(200);
  const lastUpdatedAt = ref<Date | null>(null);
  let stopLogsSubscription: (() => void) | null = null;
  let stopUsageSubscription: (() => void) | null = null;

  const runtimeLevel = computed<LogLevel>(() => config.value?.level || 'info');
  const currentBufferSize = computed(() => bufferTotal.value);
  const bufferCapacity = computed(() => config.value?.bufferSize || 0);
  const bufferUsagePercent = computed(() => {
    const capacity = config.value?.bufferSize || 0;
    if (!capacity) {
      return '0%';
    }
    return `${Math.min(100, Math.round((bufferTotal.value / capacity) * 100))}%`;
  });

  const todayDate = computed(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });

  const todayStats = computed(() => {
    if (!usageStats.value?.daily?.length) {
      return null;
    }
    return usageStats.value.daily.find((day) => day.date === todayDate.value) || null;
  });

  const pastWeekStats = computed(() => {
    if (!usageStats.value?.daily?.length) {
      return [];
    }
    return usageStats.value.daily.filter((day) => day.date !== todayDate.value).slice(0, 7);
  });

  function levelLabel(level: LogLevel | 'all') {
    if (level === 'all') {
      return '全部';
    }
    if (level === 'debug') {
      return '调试';
    }
    if (level === 'info') {
      return '信息';
    }
    if (level === 'warn') {
      return '警告';
    }
    return '错误';
  }

  function levelBadgeClass(level: LogLevel) {
    if (level === 'debug') {
      return 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300';
    }
    if (level === 'info') {
      return 'bg-primary-fixed text-on-primary-fixed';
    }
    if (level === 'warn') {
      return 'bg-tertiary-fixed text-on-tertiary-fixed';
    }
    return 'bg-error-container text-on-error-container';
  }

  async function updateRuntimeLevel() {
    savingLevel.value = true;
    const result = await rpcCall<{ success: true; level: LogLevel }>('observability.setLogLevel', token, {
      level: levelDraft.value
    });
    savingLevel.value = false;

    if (result.error) {
      error.value = result.error;
      return;
    }

    if (config.value) {
      config.value = {
        ...config.value,
        level: result.data?.level || levelDraft.value
      };
    }
  }

  function stopSubscriptions() {
    stopLogsSubscription?.();
    stopLogsSubscription = null;
    stopUsageSubscription?.();
    stopUsageSubscription = null;
  }

  function bindSubscriptions() {
    stopSubscriptions();
    loading.value = true;

    stopLogsSubscription = rpcSubscribe<ObservabilityEntriesResponse>(
      'observability.logs',
      token,
      {
        limit: limit.value,
        level: levelFilter.value === 'all' ? undefined : levelFilter.value
      },
      (data) => {
        entries.value = data.entries;
        bufferTotal.value = data.total;
        config.value = {
          level: data.level,
          bufferSize: data.bufferSize,
          pretty: config.value?.pretty ?? true
        };
        levelDraft.value = data.level;
        lastUpdatedAt.value = new Date();
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

    stopUsageSubscription = rpcSubscribe<TokenUsageStats>(
      'observability.usage',
      token,
      undefined,
      (data) => {
        usageStats.value = data;
        lastUpdatedAt.value = new Date();
      },
      {
        onError: (message) => {
          error.value = message;
        }
      }
    );
  }

  watch([levelFilter, limit], () => {
    bindSubscriptions();
  });

  onMounted(() => {
    bindSubscriptions();
  });

  onBeforeUnmount(() => {
    stopSubscriptions();
  });

  return {
    levels,
    entries: readonly(entries),
    usageStats: readonly(usageStats),
    loading: readonly(loading),
    savingLevel: readonly(savingLevel),
    error: readonly(error),
    levelFilter,
    levelDraft,
    limit,
    lastUpdatedAt: readonly(lastUpdatedAt),
    runtimeLevel,
    currentBufferSize,
    bufferCapacity,
    bufferUsagePercent,
    todayStats,
    pastWeekStats,
    levelLabel,
    levelBadgeClass,
    updateRuntimeLevel
  };
}
