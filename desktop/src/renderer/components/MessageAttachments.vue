<template>
  <div class="message-attachments">
    <span
      v-for="file in attachments"
      :key="`${file.name}-${file.size}`"
      class="attachment-chip"
      :class="{ clickable: file.path }"
      @click="file.path && openFile(file)"
    >
      <svg
        class="attachment-icon"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        v-if="file.mime.startsWith('image/')"
      >
        <rect x="2" y="2" width="12" height="12" rx="1.5" />
        <circle cx="6" cy="6" r="1.5" />
        <path d="M2 11l3-3 2 2 4-4 3 3" />
      </svg>
      <svg
        class="attachment-icon"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        v-else-if="file.mime.startsWith('audio/')"
      >
        <path d="M5 2v10" />
        <path d="M5 12a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
        <path d="M5 2l7 2v8" />
        <path d="M12 12a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
      </svg>
      <svg
        class="attachment-icon"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        v-else-if="file.mime.startsWith('video/')"
      >
        <rect x="1" y="3" width="14" height="10" rx="1.5" />
        <path d="M11 7l3-2v6l-3-2" />
      </svg>
      <svg
        class="attachment-icon"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        v-else
      >
        <path d="M5 1h4l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" />
        <path d="M9 1v4h4" />
      </svg>
      {{ file.name }}
    </span>
  </div>
</template>

<script setup lang="ts">
import type { ChatAttachment } from '../types/chat';

defineProps<{
  attachments: ChatAttachment[];
}>();

function openFile(file: ChatAttachment): void {
  if (file.path) {
    window.aesyclaw.openFolder(file.path).catch(() => {});
  }
}
</script>

<style scoped>
.message-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 260px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  font-family: var(--font-heading);
  font-size: 11px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
}

.attachment-chip.clickable {
  cursor: pointer;
}

.attachment-chip.clickable:hover {
  background: rgba(255, 255, 255, 0.28);
}

.attachment-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: currentColor;
}
</style>
