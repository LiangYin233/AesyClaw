<template>
  <div class="message-list" ref="messageListRef">
    <Transition name="fade" mode="out-in">
      <div v-if="isLoading" class="loading-state" key="loading">
        <div class="loading-skeleton">
          <div class="skeleton-line skeleton-user"></div>
          <div class="skeleton-line skeleton-assistant"></div>
          <div class="skeleton-line skeleton-assistant short"></div>
        </div>
      </div>
      <div
        v-else-if="messages.length === 0 && !activeSession?.streaming"
        class="empty-state"
        key="empty"
      >
        <p class="empty-title">Start a conversation</p>
        <p class="empty-sub">Send a message to begin your AI-powered chat.</p>
      </div>
    </Transition>

    <div v-for="(msg, i) in messages" :key="i" class="message" :class="msg.role">
      <UserMessage v-if="msg.role === 'user'" :message="msg" />
      
      <AssistantMessage
        v-else-if="msg.role === 'assistant'"
        :message="msg"
        :is-streaming="activeSession?.streaming"
        :is-menu-open="activeCopyMenuIndex === i"
        :button-label="copyButtonLabel(i)"
        @toggle-copy-menu="onToggleCopyMenu(i)"
        @copy="(mode) => copyMessage(msg, i, mode)"
      />
      
      <ToolCard v-else-if="msg.role === 'tool'" :tool-call="msg.toolCall" />
      
      <SystemMessage v-else :text="msg.text" />
    </div>

    <div
      v-if="activeSession?.streaming && !activeSession?.activeAssistantMessage"
      class="message assistant"
    >
      <div class="assistant-bubble streaming dim">Thinking&hellip;</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
import type {
  ChatMessage,
  AssistantMessage as AssistantMessageType,
  UserMessage as UserMessageType,
  ChatSession,
} from '../types/chat';
import UserMessage from './UserMessage.vue';
import AssistantMessage from './AssistantMessage.vue';
import ToolCard from './ToolCard.vue';
import SystemMessage from './SystemMessage.vue';

const props = defineProps<{
  messages: ChatMessage[];
  activeSession: ChatSession | null;
  activeCopyMenuIndex: number | null;
  isLoading?: boolean;
}>();

const emit = defineEmits<{
  'copy-message': [message: AssistantMessageType | UserMessageType, index: number, mode: 'rich' | 'raw'];
  'toggle-copy-menu': [index: number];
  'close-copy-menu': [];
}>();

const messageListRef = ref<HTMLElement | null>(null);
type CopyMode = 'rich' | 'raw';
type CopyableMessage = AssistantMessageType | UserMessageType;

const copiedState = ref<{ messageIndex: number; mode: CopyMode } | null>(null);
let copiedStateTimer: ReturnType<typeof setTimeout> | null = null;

/* ── Scroll ────────────────────────────────── */

function isNearBottom(): boolean {
  const el = messageListRef.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollToBottom() {
  nextTick(() => {
    const el = messageListRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

onMounted(scrollToBottom);

watch(
  () => {
    const lastMessage = props.messages[props.messages.length - 1];
    return {
      length: props.messages.length,
      lastText: lastMessage?.role === 'assistant' ? lastMessage.text : '',
      lastStreaming: lastMessage?.role === 'assistant' ? lastMessage.streaming : false,
    };
  },
  () => {
    if (isNearBottom()) scrollToBottom();
  },
);

/* ── Copy menu ─────────────────────────────── */

function onToggleCopyMenu(index: number): void {
  emit('toggle-copy-menu', index);
}

function closeCopyMenu(): void {
  emit('close-copy-menu');
}

function copyButtonLabel(messageIndex: number): string {
  return copiedState.value?.messageIndex === messageIndex ? 'Copied' : 'Copy';
}

/* ── Copy logic ────────────────────────────── */

async function copyMessage(
  message: CopyableMessage,
  messageIndex: number,
  mode: CopyMode,
): Promise<void> {
  const plainText = formatMessagePlainText(message);
  if (mode === 'rich') {
    await writeRichClipboard(buildMessageHtml(message), plainText);
  } else {
    await writeTextClipboard(plainText);
  }

  closeCopyMenu();
  copiedState.value = { messageIndex, mode };
  if (copiedStateTimer) clearTimeout(copiedStateTimer);
  copiedStateTimer = setTimeout(() => {
    copiedState.value = null;
  }, 1600);

  emit('copy-message', message, messageIndex, mode);
}

async function writeRichClipboard(html: string, plainText: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      // Fall back to plain text below when rich clipboard is unavailable.
    }
  }

  await writeTextClipboard(plainText);
}

async function writeTextClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to execCommand below.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function formatMessagePlainText(message: CopyableMessage): string {
  if (message.role === 'assistant') return message.text;

  const parts = [message.text.trim()];
  if (message.attachments?.length) {
    parts.push(
      [
        '[Attachments]',
        ...message.attachments.map(
          (file) =>
            `- ${file.name} (${file.mime || 'application/octet-stream'}, ${formatFileSize(file.size)})`,
        ),
      ].join('\n'),
    );
  }
  return parts.filter(Boolean).join('\n\n');
}

function buildMessageHtml(message: CopyableMessage): string {
  if (message.role === 'assistant') {
    // Import renderMarkdownSafe dynamically to avoid circular dependency
    const { renderMarkdownSafe } = require('../utils/renderContent');
    return renderMarkdownSafe(message.text);
  }

  const parts: string[] = [];
  if (message.text.trim()) {
    parts.push(`<p>${escapeHtml(message.text).replace(/\n/g, '<br>')}</p>`);
  }

  if (message.attachments?.length) {
    parts.push(
      `<ul>${message.attachments
        .map(
          (file) =>
            `<li>${escapeHtml(file.name)} (${escapeHtml(file.mime || 'application/octet-stream')}, ${formatFileSize(file.size)})</li>`,
        )
        .join('')}</ul>`,
    );
  }

  return parts.join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
  display: flex;
  flex-direction: column;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  text-align: center;
}

.empty-title {
  font-family: var(--font-heading);
  font-size: 1.1rem;
  color: var(--color-mid-gray);
  margin: 0 0 4px;
}

.empty-sub {
  font-family: var(--font-body);
  font-size: 0.85rem;
  color: var(--color-mid-gray);
  font-style: italic;
  margin: 0;
}

.message {
  margin-bottom: 20px;
}

.assistant-bubble {
  max-width: 85%;
  padding: 20px 24px;
  border-radius: 6px;
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.85;
  color: #2c2a26;
  background: #fffdf6;
  border: 1px solid #ebe6da;
}

.assistant-bubble.streaming {
  border-left: 3px solid var(--color-primary);
}

.assistant-bubble.dim {
  color: var(--color-mid-gray);
  font-style: italic;
}

/* ── Loading skeleton ──────────────────── */
.loading-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 32px;
}

.loading-skeleton {
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: skeletonFadeIn 0.3s ease;
}

.skeleton-line {
  height: 18px;
  border-radius: 6px;
  background: linear-gradient(90deg, #f0ece4 25%, #f8f6f2 50%, #f0ece4 75%);
  background-size: 200% 100%;
  animation: skeletonShimmer 1.4s ease infinite;
}

.skeleton-user {
  width: 55%;
  margin-left: auto;
  height: 16px;
  border-radius: 12px;
}

.skeleton-assistant {
  width: 80%;
  height: 14px;
}

.skeleton-assistant.short {
  width: 45%;
}

@keyframes skeletonShimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

@keyframes skeletonFadeIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ── Fade transition ─────────────────── */
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity var(--transition-fast),
    transform var(--transition-fast);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
