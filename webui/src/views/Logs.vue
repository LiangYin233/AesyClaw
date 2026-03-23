<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1680px]">
      <header class="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="cn-kicker text-outline">观测</p>
          <h1 class="cn-page-title mt-2 text-on-surface">日志观测面板</h1>
          <p class="cn-body mt-2 max-w-3xl text-sm text-on-surface-variant">查看运行日志，支持等级筛选和实时调整日志级别，便于快速定位问题。</p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button
            class="inline-flex items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-2.5 text-sm font-semibold text-on-surface shadow-sm transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            :disabled="loading"
            @click="loadLogsPage"
          >
            <AppIcon name="refresh" size="sm" />
            刷新
          </button>
          <button
            class="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition"
            :class="autoRefresh ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'border border-outline-variant/20 bg-surface-container-lowest text-on-surface'"
            type="button"
            @click="autoRefresh = !autoRefresh"
          >
            <AppIcon name="history" size="sm" />
            {{ autoRefresh ? '自动刷新中' : '开启自动刷新' }}
          </button>
        </div>
      </header>

      <div v-if="error" class="mb-6 rounded-2xl border border-error/20 bg-error-container/60 px-5 py-4 text-sm text-on-error-container">
        <div class="flex items-start gap-3">
          <AppIcon name="warning" />
          <div>
            <p class="font-bold">日志数据加载失败</p>
            <p class="mt-1 leading-6">{{ error }}</p>
          </div>
        </div>
      </div>

      <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article class="hairline-card rounded-2xl p-5">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="panel" class="text-tertiary" />
            <span class="rounded-full bg-tertiary-fixed px-2 py-0.5 text-[10px] font-bold text-on-tertiary-fixed">{{ bufferUsagePercent }}</span>
          </div>
          <p class="cn-kicker text-outline">日志条目数</p>
          <p class="cn-metric mt-1 text-on-surface">{{ currentBufferSize }}</p>
          <p class="tech-text mt-2 text-xs text-on-surface-variant">最大容量 {{ bufferCapacity }}</p>
        </article>

        <article class="hairline-card rounded-2xl p-5">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="history" class="text-sky-600" />
            <span class="rounded-full bg-surface-container-low px-2 py-0.5 text-[10px] font-bold text-outline">本次视图</span>
          </div>
          <p class="cn-kicker text-outline">已加载条目</p>
          <p class="cn-metric mt-1 text-on-surface">{{ formatNumber(entries.length) }}</p>
          <p class="mt-2 text-xs text-on-surface-variant">筛选条件：{{ levelFilter === 'all' ? '全部等级' : `${levelLabel(levelFilter)} 级` }}</p>
        </article>

        <article class="hairline-card rounded-2xl p-5">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="refresh" class="text-orange-600" />
            <span class="rounded-full bg-surface-container-low px-2 py-0.5 text-[10px] font-bold text-outline">{{ autoRefresh ? '10s' : '手动' }}</span>
          </div>
          <p class="cn-kicker text-outline">最近刷新</p>
          <p class="cn-metric mt-1 text-on-surface text-[1.5rem]">{{ lastUpdatedLabel }}</p>
          <p class="tech-text mt-2 text-xs text-on-surface-variant">{{ lastUpdatedTime }}</p>
        </article>
      </div>

      <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section class="hairline-card overflow-hidden rounded-[1.6rem]">
          <div class="flex flex-col gap-4 border-b border-outline-variant/18 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 class="cn-section-title text-on-surface">实时日志流</h2>
              <p class="mt-1 text-sm text-on-surface-variant">按时间倒序显示缓冲区中的最新日志，保留精确时间戳和字段摘要。</p>
            </div>

            <div class="flex flex-wrap gap-3">
              <label class="flex items-center gap-2 rounded-xl border border-outline-variant/18 bg-surface-container-low px-3 py-2 text-sm text-on-surface">
                <span class="text-outline">筛选等级</span>
                <select v-model="levelFilter" class="rounded-lg bg-surface-container-lowest px-2 py-1 outline-none">
                  <option value="all">全部</option>
                  <option v-for="level in levels" :key="level" :value="level">{{ levelLabel(level) }}</option>
                </select>
              </label>

              <label class="flex items-center gap-2 rounded-xl border border-outline-variant/18 bg-surface-container-low px-3 py-2 text-sm text-on-surface">
                <span class="text-outline">载入数量</span>
                <select v-model.number="limit" class="rounded-lg bg-surface-container-lowest px-2 py-1 outline-none">
                  <option :value="100">100</option>
                  <option :value="200">200</option>
                  <option :value="500">500</option>
                </select>
              </label>
            </div>
          </div>

          <div v-if="loading" class="flex h-[46rem] items-center justify-center px-5 text-center text-sm text-on-surface-variant">正在拉取日志数据...</div>

          <div v-else-if="entries.length" class="h-[46rem] overflow-y-auto divide-y divide-outline-variant/14">
            <article v-for="entry in entries" :key="entry.id" class="px-5 py-4 transition-colors hover:bg-surface-container-low/45">
              <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span :class="levelBadgeClass(entry.level)" class="rounded-full px-2.5 py-1 text-[11px] font-semibold">{{ levelLabel(entry.level) }}</span>
                    <span class="tech-text rounded-full bg-surface-container-low px-2.5 py-1 text-[11px] text-on-surface-variant">{{ entry.scope || 'root' }}</span>
                  </div>
                  <p class="cn-body mt-3 break-words text-sm text-on-surface">{{ entry.message }}</p>
                  <div v-if="entry.fields && Object.keys(entry.fields).length" class="mt-3 flex flex-wrap gap-2">
                    <span v-for="(value, key) in entry.fields" :key="key" class="tech-text rounded-full bg-surface-container-low px-2.5 py-1 text-[11px] text-on-surface-variant">
                      {{ key }}={{ formatKeyValue(value) }}
                    </span>
                  </div>
                </div>
                <div class="shrink-0 text-right">
                  <p class="tech-text text-xs text-outline">{{ formatDateTime(entry.timestamp) }}</p>
                  <p class="mt-1 text-xs text-on-surface-variant">{{ formatRelativeTime(entry.timestamp) }}</p>
                </div>
              </div>
            </article>
          </div>

          <div v-else class="flex h-[46rem] items-center justify-center px-5 text-center">
            <div>
            <p class="cn-section-title text-on-surface">当前筛选条件下没有日志</p>
            <p class="cn-body mt-2 text-sm text-on-surface-variant">可以切换筛选等级或调高运行时日志等级，查看更多调试信息。</p>
            </div>
          </div>
        </section>

        <aside class="space-y-6">
          <section class="hairline-card rounded-[1.6rem] p-5">
            <p class="cn-kicker text-outline">运行控制</p>
            <h2 class="cn-section-title mt-2 text-on-surface">调整日志等级</h2>
            <p class="mt-2 text-sm text-on-surface-variant">更新后立即作用于内存日志服务，并尝试写回配置。</p>
            <div class="mt-4 space-y-3">
              <label class="block">
                <span class="mb-2 block text-sm text-outline">目标等级</span>
                <select v-model="levelDraft" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface outline-none">
                  <option v-for="level in levels" :key="level" :value="level">{{ levelLabel(level) }}</option>
                </select>
              </label>
              <button
                class="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                :disabled="savingLevel || levelDraft === runtimeLevel"
                @click="updateRuntimeLevel"
              >
                <AppIcon name="save" size="sm" />
                {{ savingLevel ? '保存中...' : '应用日志等级' }}
              </button>
            </div>
          </section>

          <section class="hairline-card rounded-[1.6rem] p-5">
            <p class="cn-kicker text-outline">用量统计</p>
            <h2 class="cn-section-title mt-2 text-on-surface">Token 消耗</h2>
            <div class="mt-4 space-y-4">
              <div class="rounded-xl bg-surface-container-low p-4">
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <p class="text-xs text-outline">总消耗</p>
                    <p class="mt-1 text-lg font-bold text-on-surface">{{ usageStats ? formatNumber(usageStats.totalTokens) : '-' }}</p>
                  </div>
                  <div>
                    <p class="text-xs text-outline">请求次数</p>
                    <p class="mt-1 text-lg font-bold text-on-surface">{{ usageStats ? formatNumber(usageStats.requestCount) : '-' }}</p>
                  </div>
                </div>
              </div>
              <div class="rounded-xl bg-surface-container-low p-4">
                <p class="text-xs text-outline">Prompt / Completion</p>
                <p class="mt-1 text-sm font-bold text-on-surface">
                  {{ usageStats ? formatNumber(usageStats.promptTokens) : '-' }}
                  <span class="text-xs font-normal text-outline"> / </span>
                  {{ usageStats ? formatNumber(usageStats.completionTokens) : '-' }}
                </p>
              </div>
              <div v-if="usageStats?.daily?.length" class="rounded-xl bg-surface-container-low p-4">
                <p class="mb-3 text-xs text-outline">近 {{ Math.min(usageStats.daily.length, 7) }} 天趋势</p>
                <div class="space-y-2">
                  <div v-for="day in usageStats.daily.slice(0, 7)" :key="day.date" class="flex items-center justify-between text-xs">
                    <span class="text-on-surface-variant">{{ day.date }}</span>
                    <span class="tech-text font-bold text-on-surface">
                      {{ formatNumber(day.promptTokens) }}<span class="text-outline font-normal"> / </span>{{ formatNumber(day.completionTokens) }}
                    </span>
                  </div>
                </div>
              </div>
              <p v-if="usageStats" class="text-[10px] text-outline">更新于 {{ formatRelativeTime(usageStats.lastUpdated) }}</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import { apiGet, apiPost } from '@/lib/api';
import { getRouteToken } from '@/lib/auth';
import { formatDateTime, formatKeyValue, formatNumber, formatRelativeTime } from '@/lib/format';
import type { LogLevel, ObservabilityEntriesResponse, ObservabilityLogEntry, ObservabilityLoggingConfig, TokenUsageStats } from '@/lib/types';

const route = useRoute();
const token = getRouteToken(route);

const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];

const config = ref<ObservabilityLoggingConfig | null>(null);
const entries = ref<ObservabilityLogEntry[]>([]);
const usageStats = ref<TokenUsageStats | null>(null);
const bufferTotal = ref(0);
const loading = ref(false);
const savingLevel = ref(false);
const error = ref('');
const autoRefresh = ref(true);
const initialLoad = ref(true);
const levelFilter = ref<'all' | LogLevel>('all');
const levelDraft = ref<LogLevel>('info');
const limit = ref(200);
const lastUpdatedAt = ref<Date | null>(null);
let refreshTimer: number | null = null;

const runtimeLevel = computed<LogLevel>(() => config.value?.level || 'info');
const currentBufferSize = computed(() => formatNumber(bufferTotal.value));
const bufferCapacity = computed(() => formatNumber(config.value?.bufferSize || 0));
const bufferUsagePercent = computed(() => {
  const capacity = config.value?.bufferSize || 0;
  if (!capacity) return '0%';
  return `${Math.min(100, Math.round((bufferTotal.value / capacity) * 100))}%`;
});
const lastUpdatedLabel = computed(() => lastUpdatedAt.value ? formatRelativeTime(lastUpdatedAt.value) : '-');
const lastUpdatedTime = computed(() => lastUpdatedAt.value ? formatDateTime(lastUpdatedAt.value) : '-');

function levelLabel(level: LogLevel | 'all') {
  if (level === 'all') return '全部';
  if (level === 'debug') return '调试';
  if (level === 'info') return '信息';
  if (level === 'warn') return '警告';
  return '错误';
}

function levelBadgeClass(level: LogLevel) {
  if (level === 'debug') return 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300';
  if (level === 'info') return 'bg-primary-fixed text-on-primary-fixed';
  if (level === 'warn') return 'bg-tertiary-fixed text-on-tertiary-fixed';
  return 'bg-error-container text-on-error-container';
}

async function loadLogsPage() {
  if (initialLoad.value) {
    loading.value = true;
  }
  error.value = '';

  const [configResult, entriesResult, usageResult] = await Promise.all([
    apiGet<ObservabilityLoggingConfig>('/api/observability/logging/config', token),
    apiGet<ObservabilityEntriesResponse>('/api/observability/logging/entries', token, {
      limit: limit.value,
      level: levelFilter.value === 'all' ? undefined : levelFilter.value,
    }),
    apiGet<TokenUsageStats>('/api/observability/usage', token),
  ]);

  if (configResult.error || entriesResult.error) {
    error.value = configResult.error || entriesResult.error || '加载失败';
  }

  config.value = configResult.data;
  entries.value = entriesResult.data?.entries || [];
  bufferTotal.value = entriesResult.data?.total || 0;
  levelDraft.value = configResult.data?.level || levelDraft.value;
  usageStats.value = usageResult.data ?? null;
  lastUpdatedAt.value = new Date();
  loading.value = false;
  initialLoad.value = false;
}

async function updateRuntimeLevel() {
  savingLevel.value = true;
  const result = await apiPost<{ success: true; level: LogLevel }>('/api/observability/logging/level', token, {
    level: levelDraft.value,
  });
  savingLevel.value = false;

  if (result.error) {
    error.value = result.error;
    return;
  }

  if (config.value) {
    config.value = {
      ...config.value,
      level: result.data?.level || levelDraft.value,
    };
  }

  await loadLogsPage();
}

function syncAutoRefresh() {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (autoRefresh.value) {
    refreshTimer = window.setInterval(() => {
      loadLogsPage();
    }, 10000);
  }
}

watch([levelFilter, limit], () => {
  loadLogsPage();
});

watch(autoRefresh, () => {
  syncAutoRefresh();
});

onMounted(() => {
  loadLogsPage();
});

onBeforeUnmount(() => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }
});
</script>
