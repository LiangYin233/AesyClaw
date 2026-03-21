<template>
  <div v-if="detailLoading" class="py-16 text-center text-sm text-on-surface-variant">
    正在加载会话详情...
  </div>

  <div v-else-if="detailError" class="rounded-2xl border border-error/20 bg-error-container/60 px-4 py-5 text-sm text-on-error-container">
    <p class="font-bold">详情加载失败</p>
    <p class="mt-2 leading-6">{{ detailError }}</p>
  </div>

  <div v-else-if="detail" class="flex min-h-[30rem] flex-col">
    <div class="border-b border-outline-variant/16 pb-4">
      <p class="cn-kicker text-outline">会话详情</p>
      <h3 class="mt-2 break-all text-lg font-bold text-on-surface">{{ detail.key }}</h3>
      <div class="mt-3 flex flex-wrap gap-2">
        <span class="rounded-full bg-surface-container-low px-2.5 py-1 text-[11px] text-on-surface-variant">{{ detail.channel || '-' }}</span>
        <span class="tech-text rounded-full bg-surface-container-low px-2.5 py-1 text-[11px] text-on-surface-variant">chatId: {{ detail.chatId || '-' }}</span>
        <span class="rounded-full bg-primary-fixed px-2.5 py-1 text-[11px] font-semibold text-on-primary-fixed">{{ detail.agentName || 'main' }}</span>
        <span class="rounded-full bg-primary-fixed px-2.5 py-1 text-[11px] font-semibold text-on-primary-fixed">{{ detail.messageCount }} 条消息</span>
      </div>
    </div>

    <div class="mt-5 space-y-4">
      <div class="rounded-2xl bg-surface-container-low p-4">
        <p class="cn-kicker text-outline">当前路由</p>
        <p class="mt-1 text-sm text-on-surface-variant">该会话当前由 {{ detail.agentName || 'main' }} 处理。</p>
      </div>

      <div class="flex gap-2">
        <button
          class="flex-1 rounded-xl border border-outline-variant/20 px-4 py-2.5 text-sm font-semibold text-on-surface transition hover:bg-surface-container-low"
          type="button"
          @click="$emit('openDialogue')"
        >
          继续对话
        </button>
        <button
          class="rounded-xl border border-error/20 px-4 py-2.5 text-sm font-semibold text-error transition hover:bg-error-container/60"
          type="button"
          @click="$emit('deleteSession')"
        >
          删除会话
        </button>
      </div>
    </div>

    <div class="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
      <article
        v-for="(message, index) in detail.messages"
        :key="`${detail.key}-${index}`"
        class="mb-3 rounded-2xl border border-outline-variant/16 bg-surface-container-lowest p-4"
      >
        <div class="flex items-center justify-between gap-3">
          <span :class="roleClass(message.role)" class="rounded-full px-2.5 py-1 text-[11px] font-semibold">
            {{ roleLabel(message.role) }}
          </span>
          <span class="tech-text text-[11px] text-outline">
            {{ formatDateTime(message.timestamp) }} · {{ formatRelativeTime(message.timestamp) }}
          </span>
        </div>
        <p class="cn-body mt-3 whitespace-pre-wrap break-words text-sm text-on-surface">{{ message.content || '-' }}</p>
      </article>

      <div v-if="!detail.messages.length" class="rounded-2xl bg-surface-container-low px-4 py-5 text-sm text-on-surface-variant">
        该会话暂时没有可显示的消息。
      </div>
    </div>
  </div>

  <div v-else class="flex min-h-[30rem] flex-col items-center justify-center text-center">
    <div class="flex size-14 items-center justify-center rounded-2xl bg-surface-container-low text-outline">
      <AppIcon name="sessions" />
    </div>
    <p class="cn-section-title mt-5 text-on-surface">选择一个会话查看详情</p>
    <p class="cn-body mt-2 max-w-sm text-sm text-on-surface-variant">这里会显示消息时间线、当前路由角色和继续对话入口。</p>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import type { SessionDetail } from '@/lib/types';

defineProps<{
  detail: SessionDetail | null;
  detailError: string;
  detailLoading: boolean;
}>();

defineEmits<{
  (event: 'openDialogue'): void;
  (event: 'deleteSession'): void;
}>();

function roleClass(role: string) {
  if (role === 'assistant') return 'bg-primary-fixed text-on-primary-fixed';
  if (role === 'system') return 'bg-tertiary-fixed text-on-tertiary-fixed';
  return 'bg-surface-container-low text-on-surface';
}

function roleLabel(role: string) {
  if (role === 'assistant') return '助手';
  if (role === 'system') return '系统';
  return '用户';
}
</script>
