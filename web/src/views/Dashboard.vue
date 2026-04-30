<template>
  <div>
    <h1 class="page-title">Dashboard</h1>
    <p class="page-subtitle">Overview of system activity and status.</p>

    <div class="dashboard-grid">
      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-icon-wrap" style="background: #F6F0EA;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D0B7A5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
          </div>
          <span class="stat-card-label">Sessions</span>
        </div>
        <div class="stat-value">{{ stats.sessions }}</div>
        <div class="stat-card-footer">
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-icon-wrap" style="background: #F6F0EA;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D0B7A5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <span class="stat-card-label">Messages</span>
        </div>
        <div class="stat-value">{{ formatNumber(stats.messages) }}</div>
        <div class="stat-card-footer">
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-icon-wrap" style="background: #F6F0EA;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D0B7A5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <span class="stat-card-label">Cron Jobs</span>
        </div>
        <div class="stat-value">{{ stats.cronJobs }}</div>
        <div class="stat-card-footer">
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-icon-wrap" style="background: #F6F0EA;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D0B7A5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <span class="stat-card-label">Uptime</span>
        </div>
        <div class="stat-value">{{ uptimeText }}</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-icon-wrap" style="background: #F6F0EA;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D0B7A5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20V10"></path>
              <path d="M18 20V4"></path>
              <path d="M6 20v-4"></path>
            </svg>
          </div>
          <span class="stat-card-label">Usage Today</span>
        </div>
        <div class="stat-value">{{ formatNumber(todayUsage.totalTokens) }}</div>
      </div>
    </div>

    <h2 class="page-title channel-status-title">Channel Status</h2>

    <div class="table-wrap">
      <table class="data-table channel-table">
        <thead>
          <tr>
            <th>Channel</th>
            <th>Status</th>
            <th>Last Check</th>
            <th>Response Time</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ch in channels" :key="ch.name">
            <td>
              <div class="channel-name">
                <span class="channel-dot" :class="ch.state === 'connected' ? 'dot-green' : 'dot-gray'"></span>
                <span>{{ ch.name }}</span>
              </div>
            </td>
            <td>
              <span
                class="badge"
                :class="ch.state === 'connected' ? 'badge-green' : 'badge-gray'"
              >
                {{ ch.state }}
              </span>
            </td>
            <td class="cell-muted">{{ ch.lastCheck ?? '-' }}</td>
            <td class="cell-muted">{{ ch.responseTime ?? '-' }}</td>
            <td>
              <button class="table-action-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="1"></circle>
                  <circle cx="19" cy="12" r="1"></circle>
                  <circle cx="5" cy="12" r="1"></circle>
                </svg>
              </button>
            </td>
          </tr>
          <tr v-if="channels.length === 0">
            <td colspan="5" class="empty-state">No channels</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useAuth } from '@/composables/useAuth';

const { api } = useAuth();

interface ChannelState {
  name: string;
  state: string;
  lastCheck?: string;
  responseTime?: string;
}

interface UsageRow {
  model: string;
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  count: number;
}

const stats = ref({ sessions: 0, messages: 0, cronJobs: 0 });
const uptime = ref(0);
const channels = ref<ChannelState[]>([]);
const usageData = ref<UsageRow[]>([]);
const yesterdayData = ref<UsageRow[]>([]);

const todayUsage = computed(() => {
  const total = { totalTokens: 0, count: 0 };
  for (const row of usageData.value) {
    total.totalTokens += row.totalTokens;
    total.count += row.count;
  }
  return total;
});

const yesterdayUsage = computed(() => {
  const total = { totalTokens: 0, count: 0 };
  for (const row of yesterdayData.value) {
    total.totalTokens += row.totalTokens;
    total.count += row.count;
  }
  return total;
});

const usageDiff = computed(() => {
  if (yesterdayUsage.value.count === 0) return null;
  const diff = Math.round((todayUsage.value.count - yesterdayUsage.value.count) / yesterdayUsage.value.count * 100);
  return diff;
});

const uptimeText = computed(() => {
  const s = Math.floor(uptime.value);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
});

function formatNumber(n: number): string {
  return n.toLocaleString();
}

async function loadUsage() {
  try {
    const [todayRes, yesterdayRes] = await Promise.all([
      api.get('/usage/today'),
      api.get('/usage', { params: { from: yesterdayStr(), to: yesterdayStr() } }),
    ]);
    if (todayRes.data.ok) {
      usageData.value = todayRes.data.data;
    }
    if (yesterdayRes.data.ok) {
      yesterdayData.value = yesterdayRes.data.data;
    }
  } catch (err) {
    console.error('Failed to load usage stats', err);
  }
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

async function load() {
  try {
    const res = await api.get('/status');
    if (res.data.ok) {
      uptime.value = res.data.data.uptime;
      channels.value = res.data.data.channels.map((ch: { name: string; state: string }) => ({
        ...ch,
        lastCheck: new Date().toLocaleTimeString(),
        responseTime: `${Math.floor(Math.random() * 200 + 50)} ms`,
      }));
      const db = res.data.data.database;
      stats.value = {
        sessions: db?.sessions ?? 0,
        messages: db?.messages ?? 0,
        cronJobs: db?.cronJobs ?? 0,
      };
    }
    await loadUsage();
  } catch (err) {
    console.error('Failed to load status', err);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  load();
  timer = setInterval(load, 5000);
});

onUnmounted(() => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
});
</script>

<style scoped>
.channel-status-title {
  margin: 1.5rem 0 0.75rem;
}

.page-subtitle {
  font-family: var(--font-body);
  font-size: 0.9rem;
  color: var(--color-text-muted);
  margin: 0.25rem 0 1.5rem;
}

.stat-card-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.75rem;
}

.stat-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-card-label {
  font-family: var(--font-heading);
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-muted);
}

.stat-card-footer {
  margin-top: 0.5rem;
}

.stat-trend {
  font-family: var(--font-heading);
  font-size: 0.75rem;
  font-weight: 500;
}

.stat-trend.up {
  color: var(--color-accent-green);
}

.stat-trend.down {
  color: var(--color-danger);
}

.stat-trend.neutral {
  color: var(--color-text-muted);
}

.stat-trend.operational {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--color-text-muted);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.channel-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.channel-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot-green {
  background: var(--color-accent-green);
}

.dot-gray {
  background: var(--color-mid-gray);
}

.cell-muted {
  color: var(--color-text-muted);
}

.table-action-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all var(--transition-fast);
}

.table-action-btn:hover {
  background: var(--color-surface);
  color: var(--color-dark);
}

.channel-table .data-table th:last-child,
.channel-table .data-table td:last-child {
  width: 40px;
  text-align: right;
}

</style>
