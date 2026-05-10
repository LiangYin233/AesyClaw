<template>
  <div class="flex flex-col h-full">
    <div class="flex items-start justify-between gap-4 mb-4 flex-wrap shrink-0">
      <div>
        <h1 class="page-title">Logs</h1>
        <p class="page-subtitle">
          View recent in-process application logs with realtime streaming.
        </p>
      </div>

      <div class="flex items-center gap-3 flex-wrap">
        <span class="font-heading text-xs text-mid-gray">Updated {{ lastUpdatedLabel }}</span>
      </div>
    </div>

    <div
      class="flex flex-col flex-1 min-h-0 bg-[#FAF7F4] border border-[var(--color-border)] rounded-t-sm overflow-hidden"
      style="border-bottom: none"
    >
      <div v-if="errorMessage" class="px-5 py-4 shrink-0 text-danger font-body text-sm">
        {{ errorMessage }}
      </div>
      <div
        v-else-if="loading && entries.length === 0"
        class="flex-1 flex items-center justify-center text-mid-gray font-body italic text-sm"
      >
        Loading logs...
      </div>
      <div
        v-else-if="entries.length === 0"
        class="flex-1 flex items-center justify-center text-mid-gray font-body italic text-sm"
      >
        No logs captured yet.
      </div>
      <div
        v-else
        ref="log-container"
        class="flex-1 overflow-y-auto p-3 flex flex-col gap-3 bg-[#fcfbf9]"
      >
        <div
          v-for="entry in entries"
          :key="entry.id"
          class="border border-[var(--color-border)] rounded-sm px-4 py-[0.85rem] bg-white"
        >
          <div class="flex items-center gap-2 flex-wrap mb-2">
            <span class="font-heading text-[0.72rem] text-mid-gray">{{ entry.timestamp }}</span>
            <span
              class="inline-flex items-center px-2 py-[0.15rem] rounded-full font-heading text-[0.7rem] font-semibold uppercase"
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
          <pre
            class="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-[1.55] text-dark"
            >{{ entry.message }}{{ entry.details ? ' ' + entry.details : '' }}</pre
          >
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { useWebSocket } from '@/composables/useWebSocket';
import type { LogEntry } from '@/types/api';

const ws = useWebSocket();

const entries = ref<LogEntry[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const lastUpdatedAt = ref<Date | null>(null);
const logContainer = useTemplateRef<HTMLElement>('log-container');

const requestLimit = 200;

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

function scrollToBottom(): void {
  if (!logContainer.value) {
    return;
  }
  logContainer.value.scrollTop = logContainer.value.scrollHeight;
}

function isScrolledToBottom(threshold = 12): boolean {
  if (!logContainer.value) {
    return true;
  }

  const { scrollTop, clientHeight, scrollHeight } = logContainer.value;
  return scrollTop + clientHeight >= scrollHeight - threshold;
}

async function loadLogs(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const data = (await ws.send('get_logs', { limit: String(requestLimit) })) as {
      entries: LogEntry[];
      limit: number;
    };
    if (data && Array.isArray(data['entries'])) {
      entries.value = data['entries'];
      lastUpdatedAt.value = new Date();
      await nextTick();
      scrollToBottom();
      return;
    }
    errorMessage.value = 'Failed to load logs.';
  } catch {
    errorMessage.value = 'Failed to load logs.';
  } finally {
    loading.value = false;
  }
}

function handleLogEntry(data: unknown): void {
  const entry = data as LogEntry;
  if (!entry || !entry.id) {
    return;
  }

  const shouldFollow = isScrolledToBottom();
  entries.value = [...entries.value, entry].slice(-requestLimit);
  lastUpdatedAt.value = new Date();

  if (shouldFollow) {
    void nextTick().then(() => {
      scrollToBottom();
    });
  }
}

let hasConnectedOnce = false;

watch(
  () => ws.connected.value,
  (connected, wasConnected) => {
    if (connected && !hasConnectedOnce) {
      hasConnectedOnce = true;
      return;
    }

    if (connected && wasConnected === false) {
      void loadLogs();
    }
  },
);

onMounted(() => {
  void loadLogs();
  ws.on('log_entry', handleLogEntry);
});

onUnmounted(() => {
  ws.off('log_entry', handleLogEntry);
});
</script>
