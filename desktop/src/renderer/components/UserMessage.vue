<template>
  <div class="user-msg">
    <div class="user-bubble">
      <div v-if="message.text">{{ message.text }}</div>
      <MessageAttachments v-if="message.attachments?.length" :attachments="message.attachments" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { UserMessage } from '../types/chat';
import MessageAttachments from './MessageAttachments.vue';

defineProps<{
  message: UserMessage;
}>();
</script>

<style scoped>
.user-msg {
  display: flex;
  justify-content: flex-end;
}

.user-bubble {
  max-width: 70%;
  padding: 10px 16px;
  border-radius: var(--radius);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  background: var(--color-primary);
  color: #fff;
}
</style>
