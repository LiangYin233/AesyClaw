<template>
  <div>
    <h1 class="page-title">Dashboard</h1>
    <p class="page-subtitle">Overview of system activity and status.</p>

    <div
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5 mb-8"
    >
      <div
        class="bg-surface border border-[var(--color-border)] rounded p-6 flex flex-col gap-[0.35rem] shadow-sm transition-all duration-[0.3s] ease relative overflow-hidden"
      >
        <div class="flex items-center gap-2.5 mb-3">
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center"
            style="background: #f6f0ea"
          >
            <UsersIcon class="w-[18px] h-[18px] text-[#D0B7A5]" />
          </div>
          <span class="font-heading text-xs font-medium text-mid-gray">Sessions</span>
        </div>
        <div class="font-heading text-[2rem] font-bold text-dark tracking-[-0.03em] leading-[1.1]">
          {{ stats.sessions }}
        </div>
      </div>

      <div
        class="bg-surface border border-[var(--color-border)] rounded p-6 flex flex-col gap-[0.35rem] shadow-sm transition-all duration-[0.3s] ease relative overflow-hidden"
      >
        <div class="flex items-center gap-2.5 mb-3">
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center"
            style="background: #f6f0ea"
          >
            <ChatBubbleLeftRightIcon class="w-[18px] h-[18px] text-[#D0B7A5]" />
          </div>
          <span class="font-heading text-xs font-medium text-mid-gray">Messages</span>
        </div>
        <div class="font-heading text-[2rem] font-bold text-dark tracking-[-0.03em] leading-[1.1]">
          {{ formatNumber(stats.messages) }}
        </div>
      </div>

      <div
        class="bg-surface border border-[var(--color-border)] rounded p-6 flex flex-col gap-[0.35rem] shadow-sm transition-all duration-[0.3s] ease relative overflow-hidden"
      >
        <div class="flex items-center gap-2.5 mb-3">
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center"
            style="background: #f6f0ea"
          >
            <ClockIcon class="w-[18px] h-[18px] text-[#D0B7A5]" />
          </div>
          <span class="font-heading text-xs font-medium text-mid-gray">Cron Jobs</span>
        </div>
        <div class="font-heading text-[2rem] font-bold text-dark tracking-[-0.03em] leading-[1.1]">
          {{ stats.cronJobs }}
        </div>
      </div>

      <div
        class="bg-surface border border-[var(--color-border)] rounded p-6 flex flex-col gap-[0.35rem] shadow-sm transition-all duration-[0.3s] ease relative overflow-hidden"
      >
        <div class="flex items-center gap-2.5 mb-3">
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center"
            style="background: #f6f0ea"
          >
            <ChartBarSquareIcon class="w-[18px] h-[18px] text-[#D0B7A5]" />
          </div>
          <span class="font-heading text-xs font-medium text-mid-gray">Uptime</span>
        </div>
        <div class="font-heading text-[2rem] font-bold text-dark tracking-[-0.03em] leading-[1.1]">
          {{ uptimeText }}
        </div>
      </div>

      <div
        class="bg-surface border border-[var(--color-border)] rounded p-6 flex flex-col gap-[0.35rem] shadow-sm transition-all duration-[0.3s] ease relative overflow-hidden"
      >
        <div class="flex items-center gap-2.5 mb-3">
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center"
            style="background: #f6f0ea"
          >
            <ChartBarIcon class="w-[18px] h-[18px] text-[#D0B7A5]" />
          </div>
          <span class="font-heading text-xs font-medium text-mid-gray">Usage Today</span>
        </div>
        <div class="font-heading text-[2rem] font-bold text-dark tracking-[-0.03em] leading-[1.1]">
          {{ formatNumber(todayUsage.totalTokens) }}
        </div>
      </div>
    </div>

    <h2 class="page-title" style="margin: 1.5rem 0 0.75rem">Channel Status</h2>

    <div class="overflow-x-auto rounded border border-[var(--color-border)]">
      <table class="w-full border-collapse separate font-body text-sm">
        <thead>
          <tr>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Channel
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Status
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Version
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Error
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="ch in channels"
            :key="ch.name"
            class="bg-[#FDFBF9] transition-colors duration-[0.15s] ease hover:bg-[rgba(20,20,19,0.03)]"
          >
            <td class="px-4 py-3 border-b border-[var(--color-border)]">
              <div class="flex items-center gap-2">
                <span
                  class="w-2 h-2 rounded-full"
                  :class="ch.state === 'loaded' ? 'bg-accent-green' : 'bg-mid-gray'"
                ></span>
                <span>{{ ch.name }}</span>
              </div>
            </td>
            <td class="px-4 py-3 border-b border-[var(--color-border)]">
              <span
                class="inline-flex items-center px-[0.65rem] py-[0.2rem] rounded-full font-heading text-[0.7rem] font-medium tracking-[0.03em]"
                :class="
                  ch.state === 'loaded'
                    ? 'bg-[rgba(120,140,93,0.12)] text-[#5a6e47]'
                    : 'bg-[rgba(176,174,165,0.2)] text-[#8a8880]'
                "
              >
                {{ ch.state }}
              </span>
            </td>
            <td class="px-4 py-3 border-b border-[var(--color-border)] text-mid-gray">
              {{ ch.version ?? '-' }}
            </td>
            <td class="px-4 py-3 border-b border-[var(--color-border)] text-danger">
              {{ ch.error ?? '-' }}
            </td>

          </tr>
          <tr v-if="channels.length === 0">
            <td colspan="4" class="text-mid-gray text-center py-10 font-body italic text-sm">
              No channels
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useWebSocket } from '@/composables/useWebSocket';
import {
  UsersIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  ChartBarSquareIcon,
  ChartBarIcon,
} from '@heroicons/vue/24/outline';
import type { ChannelStatus, UsageSummary } from '@/types/api';

const ws = useWebSocket();

const stats = ref({ sessions: 0, messages: 0, cronJobs: 0 });
const uptime = ref(0);
const channels = ref<ChannelStatus[]>([]);
const usageData = ref<UsageSummary[]>([]);

const todayUsage = computed(() => {
  const total = { totalTokens: 0, count: 0 };
  for (const row of usageData.value) {
    total.totalTokens += row.totalTokens;
    total.count += row.count;
  }
  return total;
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
    const todayRaw = await ws.send('get_usage_today');
    usageData.value = Array.isArray(todayRaw) ? todayRaw : [];
  } catch (err) {
    console.error('Failed to load usage stats', err);
  }
}

async function load() {
  try {
    const statusData = (await ws.send('get_status')) as Record<string, unknown>;
    uptime.value = (statusData['uptime'] as number) ?? 0;
    channels.value = (statusData['channels'] as ChannelStatus[]) ?? [];
    const db = statusData['database'] as Record<string, number> | undefined;
    stats.value = {
      sessions: (db?.['sessions'] as number) ?? 0,
      messages: (db?.['messages'] as number) ?? 0,
      cronJobs: (db?.['cronJobs'] as number) ?? 0,
    };
    await loadUsage();
  } catch (err) {
    console.error('Failed to load status', err);
  }
}

watch(
  () => ws.connected.value,
  (connected) => {
    if (connected) load();
  },
  { immediate: true },
);
</script>
