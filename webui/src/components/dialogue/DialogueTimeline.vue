<template>
  <div class="mx-auto flex max-w-4xl flex-col gap-6">
    <div v-if="detailLoading" class="py-12 text-center text-sm text-on-surface-variant">正在加载对话内容...</div>

    <div v-else-if="detailError" class="rounded-2xl border border-error/20 bg-error-container/60 px-4 py-4 text-sm text-on-error-container">
      <p class="font-bold">对话加载失败</p>
      <p class="mt-2 leading-6">{{ detailError }}</p>
    </div>

    <template v-else-if="messages.length">
      <div class="flex justify-center">
        <div class="flex max-w-sm items-center gap-2 rounded-full bg-surface-container-low px-4 py-2">
          <AppIcon name="panel" size="sm" class="text-outline" />
          <span class="tech-text text-[10px] text-on-surface-variant">
            会话当前路由 {{ agentName || 'main' }} · {{ channel || 'webui' }}
          </span>
        </div>
      </div>

      <article
        v-for="(message, index) in messages"
        :key="buildSessionMessageKey(sessionKey || 'draft', message, index)"
        class="flex flex-col gap-3"
        :class="message.role === 'user' ? 'items-end' : message.role === 'system' ? 'items-center' : 'items-start'"
      >
        <template v-if="message.role === 'system'">
          <div class="rounded-full bg-surface-container-low px-4 py-2">
            <span class="tech-text text-[10px] text-on-surface-variant">{{ message.content }}</span>
          </div>
        </template>

        <template v-else-if="message.role === 'user'">
          <div class="mr-1 flex items-center gap-2">
            <span class="tech-text text-[10px] text-outline">{{ formatDateTime(message.timestamp) }}</span>
            <span class="text-xs font-bold text-on-surface">操作员</span>
            <span class="flex size-6 items-center justify-center rounded bg-on-surface text-surface">
              <AppIcon name="sessions" size="sm" />
            </span>
          </div>
          <div class="max-w-[74%] rounded-xl bg-primary p-4 text-sm text-white shadow-lg shadow-primary/10">
            <p class="whitespace-pre-wrap break-words leading-7">{{ message.content }}</p>
          </div>
        </template>

        <template v-else>
          <div class="ml-1 flex items-center gap-2">
            <span class="flex size-6 items-center justify-center rounded bg-primary-fixed text-on-primary-fixed">
              <AppIcon name="agents" size="sm" />
            </span>
            <span class="text-xs font-bold text-on-surface">{{ agentName || 'main' }}</span>
            <span class="tech-text text-[10px] text-outline">{{ formatDateTime(message.timestamp) }}</span>
          </div>
          <div class="max-w-[92%] rounded-xl bg-surface-container-lowest p-5 shadow-sm ring-1 ring-outline-variant/8">
            <p class="whitespace-pre-wrap break-words text-sm leading-7 text-on-surface">{{ message.content }}</p>
          </div>
        </template>
      </article>
    </template>

    <div v-else class="rounded-[1.4rem] bg-surface-container-low p-8 text-center">
      <p class="cn-section-title text-on-surface">准备开始新的对话</p>
      <p class="cn-body mt-2 text-sm text-on-surface-variant">输入消息后会自动创建新的 WebUI 会话，你可以在这里持续追踪整轮对话内容。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue';
import { formatDateTime } from '@/lib/format';
import { buildSessionMessageKey } from '@/lib/sessionMessages';
import type { SessionMessage } from '@/lib/types';

defineProps<{
  detailLoading: boolean;
  detailError: string;
  messages: SessionMessage[];
  sessionKey: string;
  agentName?: string;
  channel?: string;
}>();
</script>
