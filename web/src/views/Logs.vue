<template>
  <div>
    <div class="logs-header">
      <div>
        <h1 class="page-title">Logs</h1>
        <p class="page-subtitle">View recent in-process application logs with automatic polling tailing.</p>
      </div>

      <div class="logs-actions">
        <span class="poll-status" :class="autoRefreshEnabled ? 'poll-status-active' : 'poll-status-paused'">
          <span class="poll-dot"></span>
          {{ autoRefreshEnabled ? `Auto refresh every ${pollIntervalSeconds}s` : 'Auto refresh paused' }}
        </span>
        <button class="secondary-btn" type="button" @click="toggleAutoRefresh">
          {{ autoRefreshEnabled ? 'Pause Auto Refresh' : 'Resume Auto Refresh' }}
        </button>
        <button class="primary-btn" type="button" :disabled="loading" @click="loadLogs">
          {{ loading ? 'Refreshing…' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div class="log-meta-card">
      <div>
        <div class="meta-label">Showing</div>
        <div class="meta-value">Latest {{ entries.length }} entries</div>
      </div>
      <div>
        <div class="meta-label">Last updated</div>
        <div class="meta-value">{{ lastUpdatedLabel }}</div>
      </div>
    </div>

    <div class="log-panel">
      <div v-if="errorMessage" class="log-error">{{ errorMessage }}</div>
      <div v-else-if="loading && entries.length === 0" class="empty-state">Loading logs...</div>
      <div v-else-if="entries.length === 0" class="empty-state">No logs captured yet.</div>
      <div v-else ref="logContainer" class="log-list">
        <div v-for="entry in entries" :key="entry.id" class="log-entry">
          <div class="log-entry-meta">
            <span class="log-time">{{ entry.timestamp }}</span>
            <span class="log-level" :class="`log-level-${entry.level}`">{{ entry.level }}</span>
            <span class="log-scope">{{ entry.scope }}</span>
          </div>
          <pre class="log-text">{{ entry.formatted }}</pre>
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

<style scoped>
.logs-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.page-subtitle {
  font-family: var(--font-body);
  font-size: 0.9rem;
  color: var(--color-text-muted);
  margin: 0.25rem 0 0;
}

.logs-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.poll-status {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.7rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  font-family: var(--font-heading);
  font-size: 0.75rem;
  font-weight: 500;
}

.poll-status-active {
  color: #5a6e47;
  background: rgba(120, 140, 93, 0.08);
}

.poll-status-paused {
  color: var(--color-text-muted);
  background: #fff;
}

.poll-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.primary-btn,
.secondary-btn {
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.9rem;
  font-family: var(--font-heading);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.primary-btn {
  border: 1px solid var(--color-accent-orange);
  background: var(--color-accent-orange);
  color: #fff;
}

.primary-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

.secondary-btn {
  border: 1px solid var(--color-border);
  background: #fff;
  color: var(--color-dark);
}

.primary-btn:hover:not(:disabled) {
  filter: brightness(0.97);
}

.secondary-btn:hover {
  background: #faf7f4;
}

.log-meta-card {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
}

.meta-label {
  font-family: var(--font-heading);
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.meta-value {
  font-family: var(--font-heading);
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-dark);
  margin-top: 0.2rem;
}

.log-panel {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.log-error {
  padding: 1rem 1.25rem;
  color: var(--color-danger);
  font-family: var(--font-body);
  font-size: 0.85rem;
}

.log-list {
  max-height: calc(100vh - 280px);
  overflow-y: auto;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  background: #fcfbf9;
}

.log-entry {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.85rem 1rem;
  background: #fff;
}

.log-entry-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.log-time,
.log-scope {
  font-family: var(--font-heading);
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.log-level {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-family: var(--font-heading);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
}

.log-level-debug {
  background: rgba(120, 120, 120, 0.12);
  color: #666;
}

.log-level-info {
  background: rgba(106, 155, 204, 0.12);
  color: #4a7aa8;
}

.log-level-warn {
  background: rgba(196, 154, 108, 0.16);
  color: #9c6d35;
}

.log-level-error {
  background: rgba(196, 88, 88, 0.12);
  color: #b54b4b;
}

.log-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.55;
  color: var(--color-dark);
}
</style>
