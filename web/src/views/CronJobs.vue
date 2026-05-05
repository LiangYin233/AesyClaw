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
              Owner
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Next Run
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="job in jobsWithOwner" :key="job.id">
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
                <div class="flex flex-col gap-1 text-xs text-dark">
                  <span>Channel: {{ job.owner.channel }}</span>
                  <span>Type: {{ job.owner.type }}</span>
                  <span>Chat: {{ job.owner.chatId }}</span>
                </div>
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)]">
                {{ job.nextRun ? formatTime(job.nextRun) : '-' }}
              </td>
            </tr>
            <tr v-if="expanded === job.id" class="bg-[rgba(20,20,19,0.02)]">
              <td colspan="5" class="p-5">
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
          <tr v-if="jobsWithOwner.length === 0">
            <td colspan="5" class="text-mid-gray text-center py-10 font-body italic text-sm">
              No cron jobs
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="toast"
      class="fixed top-5 right-5 px-5 py-[0.85rem] rounded-sm text-white font-heading font-medium text-sm z-[200] animate-[slideInRight_0.3s_cubic-bezier(0.16,1,0.3,1)] shadow-lg"
      :class="toast.type === 'toast-success' ? 'bg-accent-green' : 'bg-danger'"
    >
      {{ toast.message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useAuth } from '@/composables/useAuth';
import { useToast } from '@/composables/useToast';

import type { CronJobRecord, CronRunRecord } from '@/types/api';

const { api } = useAuth();
const { showToast, toast } = useToast();

const jobs = ref<CronJobRecord[]>([]);
const expanded = shallowRef<string | null>(null);
const runs = ref<CronRunRecord[]>([]);
const runsLoading = shallowRef(false);

interface CronJobOwner {
  channel: string;
  type: string;
  chatId: string;
}

type CronJobWithOwner = CronJobRecord & {
  owner: CronJobOwner;
};

const missingOwner: CronJobOwner = Object.freeze({
  channel: '-',
  type: '-',
  chatId: '-',
});

const invalidOwner: CronJobOwner = Object.freeze({
  channel: 'Invalid session',
  type: '-',
  chatId: '-',
});

const jobsWithOwner = computed<CronJobWithOwner[]>(() =>
  jobs.value.map((job) => ({
    ...job,
    owner: parseSessionOwner(job.sessionKey),
  })),
);

function parseSessionOwner(sessionKey: string): CronJobOwner {
  try {
    const parsed: unknown = JSON.parse(sessionKey);
    if (!isSessionOwnerRecord(parsed)) {
      return invalidOwner;
    }

    return {
      channel: getOwnerField(parsed['channel']),
      type: getOwnerField(parsed['type']),
      chatId: getOwnerField(parsed['chatId']),
    };
  } catch {
    return invalidOwner;
  }
}

function isSessionOwnerRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getOwnerField(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : missingOwner.channel;
}

async function loadJobs() {
  try {
    const res = await api.get('/cron');
    if (res.data.ok) {
      jobs.value = res.data.data;
    }
  } catch {
    showToast('toast-error', '加载定时任务失败');
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
  } catch {
    showToast('toast-error', '加载执行历史失败');
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
