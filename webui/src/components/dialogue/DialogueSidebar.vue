<template>
  <aside
    class="fixed top-14 bottom-0 left-0 z-30 flex w-72 shrink-0 flex-col border-r border-outline-variant/10 bg-surface-container-low shadow-xl transition-transform md:left-64 xl:static xl:inset-auto xl:z-auto xl:w-80 xl:translate-x-0 xl:shadow-none"
    :class="visible ? 'translate-x-0' : '-translate-x-full xl:translate-x-0'"
  >
    <div class="space-y-4 p-4">
      <div class="relative">
        <AppIcon name="search" size="sm" class="pointer-events-none absolute left-3 top-3 text-outline" />
        <input
          :value="sessionFilter"
          class="w-full rounded-xl border border-outline-variant/12 bg-surface-container-lowest px-10 py-2.5 text-sm text-on-surface outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary-fixed"
          placeholder="筛选会话..."
          type="text"
          @input="emit('update:sessionFilter', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <div class="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button
          class="rounded-full px-3 py-1 text-[11px] font-bold transition"
          :class="agentFilter === 'all' ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'"
          type="button"
          @click="emit('update:agentFilter', 'all')"
        >
          全部
        </button>
        <button
          v-for="agentName in visibleAgentFilters"
          :key="agentName"
          class="rounded-full px-3 py-1 text-[11px] font-bold transition"
          :class="agentFilter === agentName ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'"
          type="button"
          @click="emit('update:agentFilter', agentName)"
        >
          {{ agentName }}
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <div v-if="sessionsLoading" class="px-3 py-10 text-center text-sm text-on-surface-variant">正在加载会话...</div>

      <div v-else-if="sessions.length" class="space-y-1">
        <button
          v-for="item in sessions"
          :key="item.session.key"
          class="w-full rounded-xl p-3 text-left transition"
          :class="activeSessionKey === item.session.key ? 'bg-surface-container-lowest shadow-sm ring-1 ring-primary/12' : 'hover:bg-surface-container-high'"
          type="button"
          @click="emit('openSession', item.session.key)"
        >
          <div class="mb-1 flex items-start justify-between gap-3">
            <span class="truncate text-xs font-bold text-on-surface">{{ item.title }}</span>
            <span
              class="shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold"
              :class="activeSessionKey === item.session.key ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container-highest text-outline'"
            >
              {{ item.state }}
            </span>
          </div>
          <p class="tech-text mb-2 flex items-center gap-1 text-[10px] text-outline">
            {{ item.session.agentName || 'main' }} · {{ item.session.channel || '-' }} · {{ item.session.messageCount }} 条消息
          </p>
          <p class="line-clamp-1 text-[11px] italic text-on-surface-variant">{{ item.preview }}</p>
        </button>
      </div>

      <div v-else class="px-4 py-10 text-center">
        <p class="cn-section-title text-on-surface">没有匹配的会话</p>
        <p class="mt-2 text-sm text-on-surface-variant">可以清空筛选，或者直接从右侧发起一轮新对话。</p>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue';
import type { Session } from '@/lib/types';

type DialogueSidebarItem = {
  session: Session;
  title: string;
  state: string;
  preview: string;
};

defineProps<{
  visible: boolean;
  sessionsLoading: boolean;
  sessions: DialogueSidebarItem[];
  activeSessionKey: string;
  sessionFilter: string;
  agentFilter: 'all' | string;
  visibleAgentFilters: string[];
}>();

const emit = defineEmits<{
  (event: 'update:sessionFilter', value: string): void;
  (event: 'update:agentFilter', value: 'all' | string): void;
  (event: 'openSession', key: string): void;
}>();
</script>
