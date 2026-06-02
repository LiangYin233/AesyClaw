<template>
  <div class="assistant-block">
    <div v-if="message.text && message.isIntermediate" class="assistant-bubble thinking">
      <span class="thinking-dot">&#9679;</span>
      <span class="thinking-text">{{ message.text }}</span>
    </div>
    <div v-else class="assistant-bubble" :class="{ streaming: message.streaming }">
      <div
        v-if="message.text"
        class="rendered-content"
        v-html="renderMarkdownSafe(message.text)"
      ></div>
      <div v-if="message.media?.length">
        <!-- 图片直接显示 -->
        <img
          v-for="(item, mi) in message.media.filter((m) => m.kind === 'image' && m.base64)"
          :key="'img-' + mi"
          :src="'data:' + (item.mimeType || 'image/png') + ';base64,' + item.base64"
          class="media-image-inline"
          alt=""
        />
        <!-- 其他附件用 badge -->
        <div
          v-if="message.media.filter((m) => m.kind !== 'image').length"
          class="message-attachments"
        >
          <span
            v-for="(item, mi) in message.media.filter((m) => m.kind !== 'image')"
            :key="'chip-' + mi"
            class="attachment-chip"
            :class="{ clickable: item.kind === 'file' && (item.base64 || item.localPath) }"
            @click="openMediaFile(item)"
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
              v-if="item.kind === 'audio'"
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
              v-else
            >
              <path d="M5 1h4l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" />
              <path d="M9 1v4h4" />
            </svg>
            {{ item.name || item.kind }}
          </span>
        </div>
      </div>
      <span v-if="message.streaming" class="cursor">|</span>
      <div class="message-footer">
        <span v-if="shouldShowUsage(message)" class="message-usage">{{
          formatUsage(message.usage)
        }}</span>
        <MessageActions
          v-if="!message.streaming && !isStreaming"
          :is-menu-open="isMenuOpen"
          :button-label="buttonLabel"
          @toggle-menu="$emit('toggle-copy-menu')"
          @copy="(mode) => $emit('copy', mode)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { renderMarkdownSafe } from '../utils/renderContent';
import type { DesktopUsage } from '../../preload/index';
import type { AssistantMessage, MediaItem } from '../types/chat';
import MessageActions from './MessageActions.vue';

defineProps<{
  message: AssistantMessage;
  isStreaming?: boolean;
  isMenuOpen: boolean;
  buttonLabel: string;
}>();

defineEmits<{
  'toggle-copy-menu': [];
  copy: [mode: 'rich' | 'raw'];
}>();

function openMediaFile(item: MediaItem): void {
  if (item.kind !== 'file') return;
  // 有 base64（实时消息）→ Blob 下载
  if (item.base64) {
    try {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: item.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.name || 'file';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.warn('openMediaFile base64 download failed:', err);
    }
    return;
  }
  // 有 localPath（历史消息）→ 打开所在文件夹
  if (item.localPath) {
    window.aesyclaw.openFolder(item.localPath).catch(() => {});
  }
}

function shouldShowUsage(message: AssistantMessage): boolean {
  return !message.streaming && message.usage !== undefined && message.usage.totalTokens > 0;
}

function formatUsage(usage: DesktopUsage | undefined): string {
  if (!usage) return '';
  return `IN ${formatNumber(usage.input)} / OUT ${formatNumber(usage.output)} (${formatNumber(usage.totalTokens)})`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}
</script>

<style scoped>
.assistant-block {
  display: flex;
  flex-direction: column;
}

.message-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 10px;
}

.message-usage {
  color: #8a8171;
  font-family: var(--font-heading);
  font-size: 11px;
  line-height: 1.5;
  margin-right: auto;
}

.media-image-inline {
  max-width: 100%;
  max-height: 400px;
  border-radius: 8px;
  object-fit: contain;
  margin-top: 8px;
  display: block;
}

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
  background: #eae7de;
  color: #5a4e3a;
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
  background: #ddd9ce;
}

.attachment-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: currentColor;
}

.assistant-bubble {
  max-width: 85%;
  padding: 20px 24px;
  border-radius: 6px;
  font-family: 'SourceHanSerifSC', 'Noto Serif SC', 'Songti SC', 'SimSun', var(--font-body), serif;
  font-size: 14px;
  line-height: 1.85;
  letter-spacing: 0.02em;
  color: #2c2a26;
  background: #fffdf6;
  border: 1px solid #ebe6da;
}

.rendered-content {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.rendered-content :deep(*) {
  max-width: 100%;
}

.rendered-content :deep(h1),
.rendered-content :deep(h2),
.rendered-content :deep(h3),
.rendered-content :deep(h4),
.rendered-content :deep(h5),
.rendered-content :deep(h6) {
  font-weight: 700;
  color: #1a1917;
  margin-top: 1.6em;
  margin-bottom: 0.6em;
  line-height: 1.35;
  letter-spacing: 0.04em;
}

.rendered-content :deep(h1) {
  font-size: 1.85em;
  text-align: center;
  margin-top: 0.2em;
  margin-bottom: 1em;
  padding-bottom: 0.5em;
  border-bottom: 1px solid #e8e2d4;
  font-weight: 800;
}

.rendered-content :deep(h2) {
  font-size: 1.45em;
  margin-top: 1.8em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid #ede8db;
}

.rendered-content :deep(h3) {
  font-size: 1.2em;
  color: #3d3a34;
}

.rendered-content :deep(h4) {
  font-size: 1.05em;
  color: #4a4740;
}

.rendered-content :deep(p) {
  margin: 0.8em 0;
  text-align: justify;
  text-indent: 2em;
}

.rendered-content :deep(p:first-of-type) {
  text-indent: 0;
}

.rendered-content :deep(p:last-child) {
  margin-bottom: 0;
}

.rendered-content :deep(ul),
.rendered-content :deep(ol) {
  padding-left: 2em;
  margin: 0.6em 0;
}

.rendered-content :deep(li) {
  margin: 0.35em 0;
  text-align: justify;
}

.rendered-content :deep(blockquote) {
  margin: 1.2em 0;
  padding: 0.8em 1.2em;
  background: #f9f6ef;
  border-left: 3px solid #c4b9a3;
  color: #5a554d;
  font-style: italic;
  border-radius: 0 4px 4px 0;
}

.rendered-content :deep(blockquote p) {
  text-indent: 0;
  margin: 0.4em 0;
}

.rendered-content :deep(blockquote p:first-child) {
  margin-top: 0;
}

.rendered-content :deep(blockquote p:last-child) {
  margin-bottom: 0;
}

.rendered-content :deep(code) {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  background: #f2efe8;
  padding: 0.15em 0.4em;
  border-radius: 3px;
  font-size: 0.88em;
  color: #5c5346;
  letter-spacing: 0;
}

.rendered-content :deep(pre) {
  background: #f5f2ea;
  padding: 1em 1.2em;
  border-radius: 4px;
  overflow-x: auto;
  margin: 1em 0;
  border: 1px solid #ebe6da;
}

.rendered-content :deep(pre code) {
  display: block;
  background: transparent;
  padding: 0;
  font-size: 0.85em;
  line-height: 1.6;
  color: #4a453d;
  white-space: pre;
}

.rendered-content :deep(a) {
  color: #8a7e68;
  text-decoration: none;
  border-bottom: 1px solid #d4cdb8;
  transition:
    border-color 0.2s,
    color 0.2s;
}

.rendered-content :deep(a:hover) {
  color: #6b5f4a;
  border-bottom-color: #6b5f4a;
}

.rendered-content :deep(hr) {
  border: none;
  border-top: 1px solid #e2dbd0;
  margin: 2em 5em;
  position: relative;
}

.rendered-content :deep(hr::after) {
  content: '· · ·';
  position: absolute;
  left: 50%;
  top: -0.6em;
  transform: translateX(-50%);
  background: #fffdf6;
  padding: 0 0.8em;
  color: #c4b9a3;
  font-size: 0.85em;
  letter-spacing: 0.2em;
}

.rendered-content :deep(img) {
  max-width: 100%;
  border-radius: 4px;
  display: block;
  margin: 1.2em auto;
  box-shadow: 0 2px 8px rgba(60, 50, 30, 0.08);
}

.rendered-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 0.95em;
}

.rendered-content :deep(th),
.rendered-content :deep(td) {
  border: 1px solid #e2dbd0;
  padding: 0.5em 0.8em;
  text-align: left;
}

.rendered-content :deep(th) {
  background: #f5f2ea;
  font-weight: 600;
  color: #3d3a34;
}

.rendered-content :deep(tr:nth-child(even)) {
  background: #faf8f3;
}

.rendered-content :deep(::selection) {
  background: #e8dfd0;
  color: #2c2a26;
}

.assistant-bubble.streaming {
  border-left: 3px solid var(--color-primary);
}

.assistant-bubble.thinking {
  max-width: 85%;
  display: inline-flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 6px;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-mid-gray);
  background: #f8f6f2;
  border: 1px solid #eee9e0;
  user-select: none;
  -webkit-user-select: none;
}

.thinking-dot {
  font-size: 10px;
  line-height: 1.6;
  color: var(--color-primary);
  flex-shrink: 0;
  animation: thinkingPulse 1.4s ease-in-out infinite;
}

.thinking-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
}

@keyframes thinkingPulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.cursor {
  animation: blink 1s step-end infinite;
  color: var(--color-primary);
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}
</style>
