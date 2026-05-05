<template>
  <div>
    <h1 class="page-title">Cron Jobs</h1>
    <p class="page-subtitle">Schedule recurring prompts and automated tasks for your agents.</p>

    <div class="overflow-x-auto rounded border border-[var(--color-border)]">
      <table class="w-full border-collapse separate font-body text-sm">
        <thead>
          <tr>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              ID
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Schedule
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Prompt
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Next Run
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="job in jobs" :key="job.id">
            <tr
              class="cursor-pointer bg-[#FDFBF9] transition-colors duration-[0.15s] ease hover:bg-[rgba(20,20,19,0.03)]"
              @click="toggleJob(job.id)"
            >
              <td class="px-4 py-3 border-b border-[var(--color-border)]">{{ job.id }}</td>
              <td class="px-4 py-3 border-b border-[var(--color-border)]">
                <code class="text-xs">{{ job.scheduleType }} {{ job.scheduleValue }}</code>
              </td>
              <td
                class="px-4 py-3 border-b border-[var(--color-border)] max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap"
              >
                {{ job.prompt }}
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)]">
                {{ job.nextRun ? formatTime(job.nextRun) : '-' }}
              </td>
            </tr>
            <tr v-if="expanded === job.id" class="bg-[rgba(20,20,19,0.02)]">
              <td colspan="4" class="p-5">
                <h4 class="font-heading text-sm font-semibold text-dark m-0 mb-3">
                  Execution History
                </h4>
                <div
                  v-if="runsLoading"
                  class="text-mid-gray text-center py-10 font-body italic text-sm"
                >
                  Loading...
                </div>
                <div
                  v-else-if="runs.length === 0"
                  class="text-mid-gray text-center py-10 font-body italic text-sm"
                >
                  No runs yet
                </div>
                <div v-else class="overflow-x-auto rounded border border-[var(--color-border)]">
                  <table class="w-full border-collapse separate font-body text-sm">
                    <thead>
                      <tr>
                        <th
                          class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
                        >
                          Started
                        </th>
                        <th
                          class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
                        >
                          Status
                        </th>
                        <th
                          class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
                        >
                          Result
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="run in runs" :key="run.id" class="bg-[#FDFBF9]">
                        <td class="px-4 py-3 border-b border-[var(--color-border)]">
                          {{ formatTime(run.startedAt) }}
                        </td>
                        <td class="px-4 py-3 border-b border-[var(--color-border)]">
                          <span
                            class="inline-flex items-center px-[0.65rem] py-[0.2rem] rounded-full font-heading text-[0.7rem] font-medium tracking-[0.03em]"
                            :class="
                              run.status === 'completed'
                                ? 'bg-[rgba(120,140,93,0.12)] text-[#5a6e47]'
                                : run.status === 'failed' || run.status === 'abandoned'
                                  ? 'bg-[rgba(196,91,91,0.12)] text-[#a04545]'
                                  : 'bg-[rgba(176,174,165,0.2)] text-[#8a8880]'
                            "
                          >
                            {{ run.status }}
                          </span>
                        </td>
                        <td
                          class="px-4 py-3 border-b border-[var(--color-border)] max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap"
                        >
                          {{ run.result ?? run.error ?? '-' }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="jobs.length === 0">
            <td colspan="4" class="text-mid-gray text-center py-10 font-body italic text-sm">
              No cron jobs
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from '@/composables/useAuth';

import type { CronJobRecord, CronRunRecord } from '@/types/api';

const { api } = useAuth();

const jobs = ref<CronJobRecord[]>([]);
const expanded = ref<string | null>(null);
const runs = ref<CronRunRecord[]>([]);
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
    collapseJob();
    return;
  }
  expanded.value = id;
  runsLoading.value = true;
  runs.value = [];
  try {
    const res = await api.get(`/cron/${id}/runs`);
    if (expanded.value !== id) return;
    if (res.data.ok) {
      runs.value = res.data.data;
    }
  } catch (err) {
    console.error('Failed to load cron runs', err);
  } finally {
    if (expanded.value === id) {
      runsLoading.value = false;
    }
  }
}

function collapseJob() {
  expanded.value = null;
  runs.value = [];
  runsLoading.value = false;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

onMounted(loadJobs);
</script>
