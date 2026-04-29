<template>
  <div>
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Cron Jobs</h2>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Schedule</th>
              <th>Prompt</th>
              <th>Next Run</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="job in jobs" :key="job.id">
              <tr class="row-clickable" @click="toggleJob(job.id)">
                <td>{{ job.id }}</td>
                <td>
                  <code>{{ job.scheduleType }} {{ job.scheduleValue }}</code>
                </td>
                <td class="cell-truncate">{{ job.prompt }}</td>
                <td>{{ job.nextRun ? formatTime(job.nextRun) : '-' }}</td>
              </tr>
              <tr v-if="expanded === job.id" class="expand-row">
                <td colspan="4">
                  <div class="expand-content">
                    <h4>Execution History</h4>
                    <div v-if="runsLoading" class="empty-state">Loading...</div>
                    <div v-else-if="runs.length === 0" class="empty-state">No runs yet</div>
                    <div v-else class="table-wrap">
                      <table class="data-table">
                        <thead>
                          <tr>
                            <th>Started</th>
                            <th>Status</th>
                            <th>Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="run in runs" :key="run.id">
                            <td>{{ formatTime(run.startedAt) }}</td>
                            <td>
                              <span
                                class="badge"
                                :class="
                                  run.status === 'completed'
                                    ? 'badge-green'
                                    : run.status === 'failed'
                                      ? 'badge-red'
                                      : run.status === 'running'
                                        ? 'badge-gray'
                                        : 'badge-red'
                                "
                              >
                                {{ run.status }}
                              </span>
                            </td>
                            <td class="cell-truncate">{{ run.result ?? run.error ?? '-' }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="jobs.length === 0">
              <td colspan="4" class="empty-state">No cron jobs</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from '@/composables/useAuth';

const { api } = useAuth();

interface CronJob {
  id: string;
  scheduleType: 'once' | 'daily' | 'interval';
  scheduleValue: string;
  prompt: string;
  nextRun: string | null;
  createdAt: string;
}

interface CronRun {
  id: string;
  jobId: string;
  startedAt: string;
  status: 'completed' | 'failed' | 'running' | 'abandoned';
  result: string | null;
  error: string | null;
  endedAt: string | null;
}

const jobs = ref<CronJob[]>([]);
const expanded = ref<string | null>(null);
const runs = ref<CronRun[]>([]);
const runsLoading = ref(false);

async function loadJobs() {
  try {
    const res = await api.get('/cron');
    if (res.data.ok) {
      jobs.value = res.data.data;
    }
  } catch (err) {
    console.error('Failed to load cron jobs', err);
  }
}

async function toggleJob(id: string) {
  if (expanded.value === id) {
    expanded.value = null;
    runs.value = [];
    return;
  }
  expanded.value = id;
  runsLoading.value = true;
  runs.value = [];
  try {
    const res = await api.get(`/cron/${id}/runs`);
    if (res.data.ok) {
      runs.value = res.data.data;
    }
  } catch (err) {
    console.error('Failed to load cron runs', err);
  } finally {
    runsLoading.value = false;
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

onMounted(loadJobs);
</script>

<style scoped>
.cell-truncate {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
