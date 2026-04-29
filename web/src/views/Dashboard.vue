<template>
  <div>
    <div class="dashboard-grid">
      <div class="stat-card">
        <div class="stat-value">{{ stats.sessions }}</div>
        <div class="stat-label">Sessions</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.messages }}</div>
        <div class="stat-label">Messages</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.cronJobs }}</div>
        <div class="stat-label">Cron Jobs</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ uptimeText }}</div>
        <div class="stat-label">Uptime</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Channels</h2>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ch in channels" :key="ch.name">
              <td>{{ ch.name }}</td>
              <td>
                <span
                  class="badge"
                  :class="ch.state === 'connected' ? 'badge-green' : 'badge-gray'"
                >
                  {{ ch.state }}
                </span>
              </td>
            </tr>
            <tr v-if="channels.length === 0">
              <td colspan="2" class="empty-state">No channels</td>
            </tr>
          </tbody>
        </table>
      </div>
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
}

const stats = ref({ sessions: 0, messages: 0, cronJobs: 0 });
const uptime = ref(0);
const channels = ref<ChannelState[]>([]);

const uptimeText = computed(() => {
  const s = Math.floor(uptime.value);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
});

async function load() {
  try {
    const res = await api.get('/status');
    if (res.data.ok) {
      uptime.value = res.data.data.uptime;
      channels.value = res.data.data.channels;
      const db = res.data.data.database;
      stats.value = {
        sessions: db?.sessions ?? 0,
        messages: db?.messages ?? 0,
        cronJobs: db?.cronJobs ?? 0,
      };
    }
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
