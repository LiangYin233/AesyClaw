<template>
  <div>
    <div class="flex items-start justify-between gap-4 mb-4 flex-wrap">
      <div>
        <h1 class="page-title">Logs</h1>
        <p class="page-subtitle">View recent in-process application logs with automatic polling tailing.</p>
      </div>

      <div class="flex items-center gap-3 flex-wrap">
        <span class="inline-flex items-center gap-[0.45rem] px-[0.7rem] py-[0.45rem] rounded-sm border border-[var(--color-border)] font-heading text-xs font-medium"
          :class="autoRefreshEnabled ? 'text-[#5a6e47] bg-[rgba(120,140,93,0.08)]' : 'text-mid-gray bg-white'"
        >
          <span class="w-2 h-2 rounded-full bg-current"></span>
          {{ autoRefreshEnabled ? `Auto refresh every ${pollIntervalSeconds}s` : 'Auto refresh paused' }}
        </span>
        <button
          class="rounded-sm px-[0.9rem] py-[0.5rem] font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease border border-[var(--color-border)] bg-white text-dark hover:bg-[#faf7f4]"
          type="button"
          @click="toggleAutoRefresh"
        >
          {{ autoRefreshEnabled ? 'Pause Auto Refresh' : 'Resume Auto Refresh' }}
        </button>
        <button
          class="rounded-sm px-[0.9rem] py-[0.5rem] font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease border border-primary bg-primary text-white disabled:opacity-70 disabled:cursor-wait"
          type="button"
          :disabled="loading"
          @click="loadLogs"
        >
          {{ loading ? 'Refreshing\u2026' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div class="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 bg-white border border-[var(--color-border)] rounded-sm px-5 py-4 mb-4">
      <div>
        <div class="font-heading text-[0.72rem] font-medium text-mid-gray uppercase tracking-[0.03em]">Showing</div>
        <div class="font-heading text-sm font-semibold text-dark mt-[0.2rem]">Latest {{ entries.length }} entries</div>
      </div>
      <div>
        <div class="font-heading text-[0.72rem] font-medium text-mid-gray uppercase tracking-[0.03em]">Last updated</div>
        <div class="font-heading text-sm font-semibold text-dark mt-[0.2rem]">{{ lastUpdatedLabel }}</div>
      </div>
    </div>

    <div class="bg-white border border-[var(--color-border)] rounded-sm overflow-hidden">
      <div v-if="errorMessage" class="px-5 py-4 text-danger font-body text-sm">{{ errorMessage }}</div>
      <div v-else-if="loading && entries.length === 0" class="text-mid-gray text-center py-10 font-body italic text-sm">Loading logs...</div>
      <div v-else-if="entries.length === 0" class="text-mid-gray text-center py-10 font-body italic text-sm">No logs captured yet.</div>
      <div v-else ref="logContainer" class="max-h-[calc(100vh-280px)] overflow-y-auto p-3 flex flex-col gap-3 bg-[#fcfbf9]">
        <div v-for="entry in entries" :key="entry.id" class="border border-[var(--color-border)] rounded-sm px-4 py-[0.85rem] bg-white">
          <div class="flex items-center gap-2 flex-wrap mb-2">
            <span class="font-heading text-[0.72rem] text-mid-gray">{{ entry.timestamp }}</span>
            <span class="inline-flex items-center px-2 py-[0.15rem] rounded-full font-heading text-[0.7rem] font-semibold uppercase"
              :class="{
                'bg-[rgba(120,120,120,0.12)] text-[#666]': entry.level === 'debug',
                'bg-[rgba(106,155,204,0.12)] text-[#4a7aa8]': entry.level === 'info',
                'bg-[rgba(196,154,108,0.16)] text-[#9c6d35]': entry.level === 'warn',
                'bg-[rgba(196,88,88,0.12)] text-[#b54b4b]': entry.level === 'error',
              }"
            >
              {{ entry.level }}
            </span>
            <span class="font-heading text-[0.72rem] text-mid-gray">{{ entry.scope }}</span>
          </div>
          <pre class="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-[1.55] text-dark">{{ entry.formatted }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useAuth } from '@/composables/useAuth';

interface LogEntry {
  id: number;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  details: string | null;
  formatted: string;
}

interface LogsResponseData {
  entries: LogEntry[];
  limit: number;
}

const { api } = useAuth();

const entries = ref<LogEntry[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const autoRefreshEnabled = ref(true);
const lastUpdatedAt = ref<Date | null>(null);
const logContainer = ref<HTMLElement | null>(null);

const pollIntervalMs = 5000;
const pollIntervalSeconds = pollIntervalMs / 1000;
const requestLimit = 200;

let timer: ReturnType<typeof setInterval> | null = null;

const lastUpdatedLabel = computed(() => {
  if (!lastUpdatedAt.value) {
    return 'Not refreshed yet';
  }
  return lastUpdatedAt.value.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
});

function syncPolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (autoRefreshEnabled.value) {
    timer = setInterval(() => {
      void loadLogs();
    }, pollIntervalMs);
  }
}

function scrollToBottom(): void {
  if (!logContainer.value) {
    return;
  }
  logContainer.value.scrollTop = logContainer.value.scrollHeight;
}

async function loadLogs(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const response = await api.get<{ ok: boolean; data?: LogsResponseData; error?: string }>('/logs', {
      params: { limit: requestLimit },
    });
    if (response.data.ok && response.data.data) {
      entries.value = response.data.data.entries;
      lastUpdatedAt.value = new Date();
      await nextTick();
      scrollToBottom();
      return;
    }
    errorMessage.value = response.data.error ?? 'Failed to load logs.';
  } catch {
    errorMessage.value = 'Failed to load logs.';
  } finally {
    loading.value = false;
  }
}

function toggleAutoRefresh(): void {
  autoRefreshEnabled.value = !autoRefreshEnabled.value;
  syncPolling();
}

onMounted(() => {
  void loadLogs();
  syncPolling();
});

onUnmounted(() => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
});
</script>
