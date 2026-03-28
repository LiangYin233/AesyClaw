<template>
  <div class="mx-auto max-w-4xl space-y-3 md:space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3 px-1">
      <div class="flex flex-wrap items-center gap-3 text-[10px]">
        <span class="flex items-center gap-1.5 rounded bg-primary-fixed/60 px-2 py-1 font-bold text-on-primary-fixed">
          <AppIcon name="agents" size="sm" />
          {{ agentName || 'main' }}
        </span>
        <span class="tech-text text-outline">Vision: 关闭</span>
        <span class="tech-text text-outline">会话: {{ sessionKey || '待创建' }}</span>
      </div>
    </div>

    <div class="group relative">
      <div class="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-primary/20 to-primary-container/20 opacity-0 blur transition duration-300 group-focus-within:opacity-100"></div>
      <div class="relative rounded-2xl border border-outline-variant/10 bg-surface-container-low p-2 transition-all group-focus-within:border-primary/45">
        <textarea
          v-model="draft"
          class="min-h-[72px] w-full resize-none bg-transparent px-3 py-3 text-sm text-on-surface outline-none placeholder:text-outline md:min-h-[108px]"
          placeholder="输入消息..."
          @keydown="handleDraftKeydown"
        ></textarea>

        <div class="flex items-center justify-end px-2 pb-2">
          <button
            class="flex items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-primary-container px-5 py-2 text-sm font-bold text-white shadow-md transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="sending || !draft.trim()"
            type="button"
            @click="emit('send')"
          >
            {{ sending ? '发送中...' : '发送消息' }}
            <AppIcon name="arrowRight" size="sm" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue';

const draft = defineModel<string>({ required: true });

const props = defineProps<{
  sending: boolean;
  agentName?: string;
  sessionKey: string;
}>();

const emit = defineEmits<{
  (event: 'send'): void;
}>();

function handleDraftKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (!props.sending && draft.value.trim()) {
      emit('send');
    }
  }
}
</script>
