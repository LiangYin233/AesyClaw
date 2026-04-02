<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue';
import AgentWorkerNodeTree from './AgentWorkerNodeTree.vue';
import {
  formatSessionTarget,
  formatWorkerStatus,
  formatWorkerTime,
  shortExecutionId,
  workerStatusTone
} from '@/lib/agentWorkers';
import type { WorkerRuntimeSession } from '@/lib/types';

interface Props {
  session: WorkerRuntimeSession | null;
  abortingSessionKey: string;
}

defineProps<Props>();

defineEmits<{
  abort: [sessionKey: string];
}>();
</script>

<template>
  <section class="rounded-[1.6rem] border border-outline-variant/10 bg-surface-container-lowest p-5 shadow-sm">
    <div v-if="!session" class="flex min-h-[480px] items-center justify-center rounded-2xl border border-dashed border-outline-variant/25 bg-surface-container-low px-6 text-center text-sm leading-6 text-on-surface-variant">
      请先选择 session。
    </div>

    <div v-else class="space-y-6">
      <div class="flex flex-col gap-4 rounded-2xl border border-outline-variant/10 bg-gradient-to-r from-surface-container-low to-white p-5">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0">
            <p class="cn-kicker text-outline">Worker Detail</p>
            <h3 class="mt-2 break-all font-headline text-xl font-bold text-on-surface">{{ session.sessionKey }}</h3>
            <p class="mt-2 text-sm text-on-surface-variant">{{ formatSessionTarget(session) }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <span class="rounded-full px-3 py-1 text-xs font-bold" :class="workerStatusTone(session.status)">
              {{ formatWorkerStatus(session.status) }}
            </span>
            <button
              class="inline-flex items-center gap-2 rounded-xl border border-error/15 bg-error-container/40 px-4 py-2.5 text-sm font-bold text-on-error-container transition hover:bg-error-container/70 disabled:cursor-not-allowed disabled:opacity-60"
              type="button"
              :disabled="abortingSessionKey === session.sessionKey"
              @click="$emit('abort', session.sessionKey)"
            >
              <AppIcon name="warning" size="sm" />
              {{ abortingSessionKey === session.sessionKey ? '中止中...' : '中止执行链' }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <div class="rounded-xl border border-white/80 bg-white/70 p-3">
            <span class="block text-[10px] tracking-[0.08em] text-outline">根执行</span>
            <span class="mt-1 block font-mono text-xs font-bold text-on-surface">{{ shortExecutionId(session.rootExecutionId) }}</span>
          </div>
          <div class="rounded-xl border border-white/80 bg-white/70 p-3">
            <span class="block text-[10px] tracking-[0.08em] text-outline">活跃节点</span>
            <span class="mt-1 block text-xs font-bold text-on-surface">{{ session.activeWorkerCount }}</span>
          </div>
          <div class="rounded-xl border border-white/80 bg-white/70 p-3">
            <span class="block text-[10px] tracking-[0.08em] text-outline">总节点</span>
            <span class="mt-1 block text-xs font-bold text-on-surface">{{ session.totalWorkerCount }}</span>
          </div>
          <div class="rounded-xl border border-white/80 bg-white/70 p-3">
            <span class="block text-[10px] tracking-[0.08em] text-outline">开始时间</span>
            <span class="mt-1 block text-xs font-semibold text-on-surface">{{ formatWorkerTime(session.startedAt) }}</span>
          </div>
          <div class="rounded-xl border border-white/80 bg-white/70 p-3">
            <span class="block text-[10px] tracking-[0.08em] text-outline">最近更新</span>
            <span class="mt-1 block text-xs font-semibold text-on-surface">{{ formatWorkerTime(session.updatedAt) }}</span>
          </div>
        </div>
      </div>

      <div class="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-5">
        <div class="mb-4 flex items-center justify-between">
          <div>
            <p class="cn-kicker text-outline">Execution Tree</p>
            <h4 class="mt-2 font-headline text-lg font-bold text-on-surface">Worker 节点树</h4>
          </div>
          <span class="rounded-full bg-surface-container-high px-3 py-1 text-xs font-bold text-on-surface-variant">
            {{ session.workers.length }} 条根链路
          </span>
        </div>
        <AgentWorkerNodeTree :nodes="session.workers" />
      </div>
    </div>
  </section>
</template>
