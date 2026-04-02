<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from '@/components/AppIcon.vue';
import type { WorkerRuntimeSnapshot } from '@/lib/types';

interface Props {
  snapshot: WorkerRuntimeSnapshot | null;
  loading: boolean;
  error: string;
}

const props = defineProps<Props>();

const totalSessions = computed(() => props.snapshot?.sessions.length ?? 0);
const activeSessions = computed(() => props.snapshot?.activeSessionCount ?? 0);
const activeWorkers = computed(() => props.snapshot?.activeWorkerCount ?? 0);
</script>

<template>
  <section class="mb-10 rounded-[1.75rem] border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm">
    <div class="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <p class="cn-kicker text-outline">Worker Runtime</p>
        <h2 class="mt-2 font-headline text-2xl font-bold tracking-tight text-on-surface">执行链可视化</h2>
      </div>
    </div>

    <div v-if="error" class="mb-6 rounded-2xl border border-error/20 bg-error-container/50 px-5 py-4 text-sm text-on-error-container">
      <div class="flex items-start gap-3">
        <AppIcon name="warning" />
        <div>
          <p class="font-bold">Worker 运行态加载失败</p>
          <p class="mt-1 leading-6">{{ error }}</p>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div class="flex min-h-32 flex-col justify-between rounded-2xl border border-outline-variant/10 bg-gradient-to-br from-primary-fixed to-surface-container-low p-5">
        <div class="flex items-start justify-between">
          <span class="cn-kicker text-outline">活跃会话</span>
          <AppIcon name="sessions" class="text-primary" />
        </div>
        <div class="cn-metric text-on-surface">{{ activeSessions }}</div>
      </div>
      <div class="flex min-h-32 flex-col justify-between rounded-2xl border border-outline-variant/10 bg-surface-container-low p-5">
        <div class="flex items-start justify-between">
          <span class="cn-kicker text-outline">活跃 Worker</span>
          <AppIcon name="robot" class="text-tertiary" />
        </div>
        <div class="cn-metric text-on-surface">{{ activeWorkers }}</div>
      </div>
      <div class="flex min-h-32 flex-col justify-between rounded-2xl border border-outline-variant/10 bg-surface-container-low p-5">
        <div class="flex items-start justify-between">
          <span class="cn-kicker text-outline">可见执行链</span>
          <AppIcon name="overview" class="text-sky-600" />
        </div>
        <div class="cn-metric text-on-surface">{{ totalSessions }}</div>
      </div>
    </div>
  </section>
</template>
