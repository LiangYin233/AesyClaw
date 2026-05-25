<template>
  <div class="message-list" ref="messageListRef">
    <div v-if="messages.length === 0 && !activeSession?.streaming" class="empty-state">
      <p class="empty-title">Start a conversation</p>
      <p class="empty-sub">Send a message to begin your AI-powered chat.</p>
    </div>

    <div v-for="(msg, i) in messages" :key="i" class="message" :class="msg.role">
      <!-- User -->
      <div v-if="msg.role === 'user'" class="user-msg">
        <div class="user-bubble">
          <div v-if="msg.text">{{ msg.text }}</div>
          <div v-if="msg.attachments?.length" class="message-attachments">
            <span
              v-for="file in msg.attachments"
              :key="`${file.name}-${file.size}`"
              class="attachment-chip"
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
        </div>
      </div>

      <!-- Assistant -->
      <div v-else-if="msg.role === 'assistant'" class="assistant-block">
        <div v-if="msg.text && msg.isIntermediate" class="assistant-bubble thinking">
          <span class="thinking-dot">&#9679;</span>
          <span class="thinking-text">{{ msg.text }}</span>
        </div>
        <div v-else class="assistant-bubble" :class="{ streaming: msg.streaming }">
          <div v-if="msg.text" class="rendered-content" v-html="renderMarkdownSafe(msg.text)"></div>
          <div v-if="msg.media?.length" class="message-attachments">
            <span
              v-for="(item, mi) in msg.media"
              :key="mi"
              class="attachment-chip"
              :class="{ clickable: item.kind === 'file' && item.base64 }"
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
                v-if="item.kind === 'image'"
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
                v-else-if="item.kind === 'audio'"
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
          <span v-if="msg.streaming" class="cursor">|</span>
          <div class="message-footer">
            <span v-if="shouldShowUsage(msg)" class="message-usage">{{
              formatUsage(msg.usage)
            }}</span>
            <div
              v-if="!msg.streaming && !activeSession?.streaming"
              class="message-actions"
              @click.stop
            >
              <button
                type="button"
                class="copy-btn"
                aria-haspopup="menu"
                :aria-expanded="activeCopyMenuIndex === i"
                @click="onToggleCopyMenu(i)"
              >
                {{ copyButtonLabel(i) }}
              </button>
              <div v-if="activeCopyMenuIndex === i" class="copy-menu" role="menu">
                <button
                  type="button"
                  class="copy-menu-item"
                  role="menuitem"
                  @click="copyMessage(msg, i, 'rich')"
                >
                  &#x590D;&#x5236;&#x5BCC;&#x6587;&#x672C;
                </button>
                <button
                  type="button"
                  class="copy-menu-item"
                  role="menuitem"
                  @click="copyMessage(msg, i, 'raw')"
                >
                  &#x590D;&#x5236;&#x539F;&#x6587;
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tool -->
      <div v-else-if="msg.role === 'tool'" class="tool-block">
        <div
          class="tool-card"
          :class="{ expanded: msg.toolCall.expanded, error: msg.toolCall.status === 'error' }"
        >
          <div class="tool-card-header" @click="msg.toolCall.expanded = !msg.toolCall.expanded">
            <span class="tool-arrow">{{ msg.toolCall.expanded ? '&#9662;' : '&#9658;' }}</span>
            <span class="tool-status-dot" :class="msg.toolCall.status"></span>
            <span class="tool-name">{{ msg.toolCall.toolName }}</span>
          </div>
          <div v-if="msg.toolCall.expanded" class="tool-card-body">
            <div class="tool-section tool-section--result">
              <span class="tool-label">Args</span>
              <pre>{{ JSON.stringify(msg.toolCall.args, null, 2) }}</pre>
            </div>
            <div v-if="msg.toolCall.result !== undefined" class="tool-section tool-section--result">
              <span class="tool-label">Result</span>
              <pre>{{ formatToolResult(msg.toolCall.result) }}</pre>
            </div>
          </div>
        </div>
      </div>

      <!-- System -->
      <div v-else class="system-msg">
        <div class="system-bubble">{{ msg.text }}</div>
      </div>
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
import { renderMarkdownSafe } from '../utils/renderContent';
import type { DesktopUsage } from '../../preload/index';
import type {
  ChatMessage,
  AssistantMessage,
  UserMessage,
  MediaItem,
  ChatSession,
} from '../composables/useChat';
const props = defineProps<{
  messages: ChatMessage[];
  activeSession: ChatSession | null;
  activeCopyMenuIndex: number | null;
}>();

const emit = defineEmits<{
  'copy-message': [message: AssistantMessage | UserMessage, index: number, mode: 'rich' | 'raw'];
  'toggle-copy-menu': [index: number];
  'close-copy-menu': [];
}>();

const messageListRef = ref<HTMLElement | null>(null);
type CopyMode = 'rich' | 'raw';
type CopyableMessage = AssistantMessage | UserMessage;

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

// 监听消息数量和最后一条流式文本变化：用户仍在底部时自动跟随；用户向上查看历史时不打断。
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

/* ── Media file ────────────────────────────── */

async function openMediaFile(item: MediaItem): void {
  if (item.kind !== 'file' || !item.base64) return;
  try {
    const filePath = await window.aesyclaw.saveFile(item.name ?? 'file', item.base64);
    await window.aesyclaw.openFolder(filePath);
  } catch {
    // 静默失败
  }
}

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
  if (message.role === 'assistant') return renderMarkdownSafe(message.text);

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

/* ── Format helpers ────────────────────────── */

function shouldShowUsage(message: AssistantMessage): boolean {
  return !message.streaming && message.usage !== undefined && message.usage.totalTokens > 0;
}

function formatUsage(usage: DesktopUsage): string {
  return `Usage: ${formatNumber(usage.totalTokens)} tokens`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatToolResult(result: unknown): string {
  let text: string;
  if (typeof result === 'string') {
    text = result;
  } else {
    text = JSON.stringify(result, null, 2);
  }
  if (text.length > 5000) {
    return text.slice(0, 5000) + '\n\n... (truncated, ' + text.length + ' characters)';
  }
  return text;
}
</script>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
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

/* ── Messages ────────────────────────── */
.message {
  margin-bottom: 20px;
}

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

.message-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 10px;
}

.assistant-bubble .message-footer {
  justify-content: flex-end;
}

.assistant-media {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.media-item {
  max-width: 100%;
}

.media-image {
  max-width: 100%;
  max-height: 400px;
  border-radius: 8px;
  object-fit: contain;
}

.media-file-link {
  display: inline-block;
  padding: 6px 12px;
  background: #f0eee8;
  border-radius: 6px;
  color: #5a4e3a;
  text-decoration: none;
  font-size: 13px;
}

.media-file-link:hover {
  background: #e2dfd6;
}

.media-audio {
  max-width: 100%;
  height: 40px;
}

.message-usage {
  color: #8a8171;
  font-family: var(--font-heading);
  font-size: 11px;
  line-height: 1.5;
  margin-right: auto;
}

.user-bubble .message-usage {
  color: rgba(255, 255, 255, 0.72);
}

.message-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  position: relative;
}

.copy-btn {
  min-width: 44px;
  padding: 2px 8px;
  border-radius: 999px;
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 11px;
  line-height: 1.5;
  transition: all var(--transition-fast);
}

.user-bubble .copy-btn {
  color: rgba(255, 255, 255, 0.86);
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.28);
}

.user-bubble .copy-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.2);
}

.assistant-bubble .copy-btn {
  color: #7a705e;
  background: #f8f4ea;
  border: 1px solid #e6dece;
}

.assistant-bubble .copy-btn:hover {
  color: #4a4235;
  background: #f1eadc;
}

.copy-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 5;
  min-width: 112px;
  padding: 4px;
  border-radius: var(--radius-sm);
  background: #fff;
  border: 1px solid var(--color-border);
  box-shadow: 0 6px 18px rgba(20, 20, 19, 0.12);
}

.copy-menu-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-dark);
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
}

.copy-menu-item:hover {
  background: #f7f0ea;
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

.assistant-bubble.dim {
  color: var(--color-mid-gray);
  font-style: italic;
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

.system-bubble {
  max-width: 50%;
  margin: 0 auto;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-family: var(--font-body);
  font-size: 12px;
  text-align: center;
  background: #fef9e7;
  color: var(--color-warning);
  border: 1px solid rgba(201, 163, 90, 0.3);
}

/* ── Message attachments ─────────────── */
.message-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.attachment-chip.clickable {
  cursor: pointer;
}

.attachment-chip.clickable:hover {
  background: #e2dfd6;
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

.attachment-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: currentColor;
}

/* ── Tool cards ──────────────────────── */
.tool-block {
  display: flex;
}

.tool-card {
  margin: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--color-surface);
  max-width: 85%;
}

.tool-card.error {
  border-color: rgba(196, 91, 91, 0.4);
}

.tool-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-mid-gray);
  transition: background var(--transition-fast);
  user-select: none;
  -webkit-user-select: none;
}

.tool-card-header:hover {
  background: rgba(20, 20, 19, 0.03);
}

.tool-arrow {
  font-size: 10px;
  width: 14px;
  color: var(--color-mid-gray);
}

.tool-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.tool-status-dot.running {
  background: var(--color-warning);
}

.tool-status-dot.done {
  background: var(--color-accent-green);
}

.tool-status-dot.error {
  background: var(--color-danger);
}

.tool-card-body {
  padding: 10px 12px;
  border-top: 1px solid var(--color-border);
}

.tool-section {
  margin-bottom: 10px;
}

.tool-section:last-child {
  margin-bottom: 0;
}

.tool-label {
  font-family: var(--font-heading);
  font-size: 10px;
  font-weight: 600;
  color: var(--color-mid-gray);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  display: block;
  margin-bottom: 4px;
}

.tool-section pre {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 12px;
  color: var(--color-dark);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 180px;
  overflow-y: auto;
  margin: 0;
  line-height: 1.5;
}

.tool-section--result {
  background: rgba(20, 20, 19, 0.02);
  border-radius: 4px;
  padding: 8px;
  margin-left: 0;
  margin-right: 0;
}

.tool-section--result .tool-label {
  margin-bottom: 6px;
}

.tool-section--result pre {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.7;
  max-height: 240px;
  color: #3d3a34;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 4px 0;
  margin: 0;
}
</style>
