<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue';
import {
  formatSessionTarget,
  formatWorkerStatus,
  formatWorkerTime,
  shortExecutionId,
  workerStatusTone
} from '@/lib/agentWorkers';
import type { WorkerRuntimeSession } from '@/lib/types';

interface Props {
  sessions: WorkerRuntimeSession[];
  selectedSessionKey: string;
  abortingSessionKey: string;
}

const props = defineProps<Props>();

defineEmits<{
  select: [sessionKey: string];
  abort: [sessionKey: string];
}>();
</script>

<template>
  <section class="rounded-[1.6rem] border border-outline-variant/10 bg-surface-container-lowest p-5 shadow-sm">
    <div class="mb-4 flex items-center justify-between">
      <div>
        <p class="cn-kicker text-outline">Session Queue</p>
        <h3 class="mt-2 font-headline text-xl font-bold text-on-surface">活跃执行链</h3>
      </div>
      <span class="rounded-full bg-surface-container-high px-3 py-1 text-xs font-bold text-on-surface-variant">
        {{ sessions.length }} 条
      </span>
    </div>

    <div v-if="sessions.length === 0" class="rounded-2xl border border-dashed border-outline-variant/30 bg-surface-container-low px-5 py-8 text-center text-sm text-on-surface-variant">
      当前没有可展示的 worker 执行链。
    </div>

    <div
      v-else
      class="gap-4"
      :class="props.sessions.length > 1 ? 'flex overflow-x-auto pb-2' : 'space-y-4'"
    >
      <div
        v-for="session in props.sessions"
        :key="session.sessionKey"
        class="block rounded-2xl border p-4 text-left transition-all"
        :class="[
          props.sessions.length > 1 ? 'w-full max-w-[min(440px,calc(100vw-4rem))] shrink-0 md:max-w-[min(480px,calc(100vw-6rem))]' : 'w-full',
          session.sessionKey === selectedSessionKey
            ? 'border-primary/25 bg-primary-fixed/35 shadow-lg shadow-primary/5'
            : 'border-outline-variant/10 bg-surface-container-low hover:border-slate-300 hover:shadow-md'
        ]"
        @click="$emit('select', session.sessionKey)"
      >
        <div class="mb-3 flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="truncate font-mono text-[11px] text-outline">{{ session.sessionKey }}</p>
            <p class="mt-2 text-sm font-semibold text-on-surface">{{ formatSessionTarget(session) }}</p>
          </div>
          <span class="rounded-full px-3 py-1 text-[11px] font-bold" :class="workerStatusTone(session.status)">
            {{ formatWorkerStatus(session.status) }}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-3 text-xs text-on-surface-variant md:grid-cols-4">
          <div class="rounded-xl bg-white/70 px-3 py-2">
            <span class="block text-[10px] tracking-[0.08em] text-outline">根执行</span>
            <span class="mt-1 block font-mono text-on-surface">{{ shortExecutionId(session.rootExecutionId) }}</span>
          </div>
          <div class="rounded-xl bg-white/70 px-3 py-2">
            <span class="block text-[10px] tracking-[0.08em] text-outline">活跃节点</span>
            <span class="mt-1 block font-bold text-on-surface">{{ session.activeWorkerCount }}</span>
          </div>
          <div class="rounded-xl bg-white/70 px-3 py-2">
            <span class="block text-[10px] tracking-[0.08em] text-outline">总节点</span>
            <span class="mt-1 block font-bold text-on-surface">{{ session.totalWorkerCount }}</span>
          </div>
          <div class="rounded-xl bg-white/70 px-3 py-2">
            <span class="block text-[10px] tracking-[0.08em] text-outline">最近更新</span>
            <span class="mt-1 block font-medium text-on-surface">{{ formatWorkerTime(session.updatedAt) }}</span>
          </div>
        </div>

        <div class="mt-4 flex items-center justify-between border-t border-outline-variant/10 pt-4">
          <span class="text-xs font-medium text-on-surface-variant">Worker 树已就绪</span>
          <button
            class="inline-flex items-center gap-2 rounded-lg border border-error/15 bg-error-container/40 px-3 py-2 text-xs font-bold text-on-error-container transition hover:bg-error-container/70 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            :disabled="abortingSessionKey === session.sessionKey"
            @click.stop="$emit('abort', session.sessionKey)"
          >
            <AppIcon name="warning" size="sm" />
            {{ abortingSessionKey === session.sessionKey ? '中止中...' : '中止执行链' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
