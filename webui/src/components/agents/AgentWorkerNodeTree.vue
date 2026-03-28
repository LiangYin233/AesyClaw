<script setup lang="ts">
import { computed } from 'vue';
import {
  buildWorkerActivitySlots,
  formatWorkerStatus,
  formatWorkerTime,
  shortExecutionId,
  workerKindLabel,
  workerStatusTone
} from '@/lib/agentWorkers';
import type { WorkerRuntimeNode } from '@/lib/types';

defineOptions({
  name: 'AgentWorkerNodeTree'
});

interface Props {
  nodes: WorkerRuntimeNode[];
  depth?: number;
}

const props = withDefaults(defineProps<Props>(), {
  depth: 0
});

const leftPadding = computed(() => `${props.depth * 18}px`);

function activitySlots(node: WorkerRuntimeNode) {
  return buildWorkerActivitySlots(node);
}
</script>

<template>
  <div class="space-y-3">
    <div
      v-for="node in nodes"
      :key="node.executionId"
      class="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-4"
      :style="{ marginLeft: leftPadding }"
    >
      <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full bg-surface-container-high px-2.5 py-1 text-[10px] font-bold tracking-[0.08em] text-on-surface-variant">
              {{ workerKindLabel(node.kind) }}
            </span>
            <span class="rounded-full px-2.5 py-1 text-[10px] font-bold" :class="workerStatusTone(node.status)">
              {{ formatWorkerStatus(node.status) }}
            </span>
          </div>
          <h4 class="mt-3 text-sm font-bold text-on-surface">{{ node.agentName || '未命名 Agent' }}</h4>
          <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-on-surface-variant">
            <span class="font-mono">exec: {{ shortExecutionId(node.executionId) }}</span>
            <span v-if="node.childPid !== null && node.childPid !== undefined">pid: {{ node.childPid }}</span>
            <span v-if="node.model">{{ node.model }}</span>
          </div>
        </div>

        <div class="rounded-xl bg-white/70 px-3 py-2 text-[11px] text-on-surface-variant">
          <div>开始：{{ formatWorkerTime(node.startedAt) }}</div>
          <div class="mt-1">更新：{{ formatWorkerTime(node.updatedAt) }}</div>
        </div>
      </div>

      <div v-if="node.error" class="mt-3 rounded-xl border border-error/20 bg-error-container/50 px-3 py-3 text-xs leading-5 text-on-error-container">
        {{ node.error }}
      </div>

      <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div
          v-for="slot in activitySlots(node)"
          :key="slot.key"
          class="rounded-xl border px-3 py-3 text-xs text-on-surface"
          :class="[slot.borderTone, slot.backgroundTone]"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full bg-white/80 px-2 py-1 text-[10px] font-bold tracking-[0.08em]" :class="slot.accentTone">
              {{ slot.title }}
            </span>
            <span class="rounded-full bg-white/80 px-2 py-1 text-[10px] font-bold text-on-surface-variant">
              {{ slot.badge }}
            </span>
          </div>
          <div class="mt-2 text-[12px] font-semibold text-on-surface">{{ slot.primaryText }}</div>
          <div v-if="slot.secondaryText" class="mt-1 text-[11px] text-on-surface-variant">
            {{ slot.secondaryText }}
          </div>
          <div v-if="slot.startedAt" class="mt-1 text-[11px] text-on-surface-variant">
            {{ slot.timeLabel || '开始于' }} {{ formatWorkerTime(slot.startedAt) }}
          </div>
        </div>
      </div>

      <div v-if="node.children.length > 0" class="mt-4 border-l border-outline-variant/15 pl-3">
        <AgentWorkerNodeTree :nodes="node.children" :depth="depth + 1" />
      </div>
    </div>
  </div>
</template>
