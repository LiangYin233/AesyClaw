<template>
  <div class="chat-view">
    <!-- Session list -->
    <div class="session-list">
      <button class="new-chat-btn" @click="createSession">
        <span>+</span> New Chat
      </button>
      <div
        v-for="session in sessions"
        :key="session.id"
        class="session-item"
        :class="{ active: session.id === activeSessionId }"
        @click="activeSessionId = session.id"
      >
        <span class="session-title">{{ session.title }}</span>
        <span v-if="session.streaming" class="session-badge">…</span>
      </div>
      <div v-if="sessions.length === 0" class="empty-sessions">
        No conversations yet
      </div>
    </div>

    <!-- Chat area -->
    <div class="chat-area" v-if="activeSession()">
      <div class="message-list" ref="messageListRef">
        <div v-if="activeSession()!.messages.length === 0 && !activeSession()!.streaming" class="empty-state">
          <p class="empty-title">Start a conversation</p>
          <p class="empty-sub">Send a message to begin your AI-powered chat.</p>
        </div>

        <div
          v-for="(msg, i) in activeSession()!.messages"
          :key="i"
          class="message"
          :class="msg.role"
        >
          <!-- User -->
          <div v-if="msg.role === 'user'" class="user-msg">
            <div class="user-bubble">{{ msg.text }}</div>
          </div>

          <!-- Assistant -->
          <div v-else-if="msg.role === 'assistant'" class="assistant-block">
            <div v-if="msg.text" class="assistant-bubble" :class="{ streaming: msg.streaming }">
              <div class="rendered-content" v-html="renderMarkdownSafe(msg.text)"></div>
              <span v-if="msg.streaming" class="cursor">|</span>
            </div>
          </div>

          <!-- Tool -->
          <div v-else-if="msg.role === 'tool'" class="tool-block">
            <div
              class="tool-card"
              :class="{ expanded: msg.toolCall.expanded, error: msg.toolCall.status === 'error' }"
            >
              <div class="tool-card-header" @click="msg.toolCall.expanded = !msg.toolCall.expanded">
                <span class="tool-arrow">{{ msg.toolCall.expanded ? '▾' : '▸' }}</span>
                <span class="tool-status-dot" :class="msg.toolCall.status"></span>
                <span class="tool-name">{{ msg.toolCall.toolName }}</span>
              </div>
              <div v-if="msg.toolCall.expanded" class="tool-card-body">
                <div class="tool-section">
                  <span class="tool-label">Args</span>
                  <pre>{{ JSON.stringify(msg.toolCall.args, null, 2) }}</pre>
                </div>
                <div v-if="msg.toolCall.result !== undefined" class="tool-section">
                  <span class="tool-label">Result</span>
                  <pre>{{ JSON.stringify(msg.toolCall.result, null, 2) }}</pre>
                </div>
              </div>
            </div>
          </div>

          <!-- System -->
          <div v-else class="system-msg">
            <div class="system-bubble">{{ msg.text }}</div>
          </div>
        </div>

        <div v-if="activeSession()?.streaming && !activeSession()?.activeAssistantMessage" class="message assistant">
          <div class="assistant-bubble streaming dim">
            Thinking…
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="input-area">
        <textarea
          v-model="inputText"
          class="chat-input"
          placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
          rows="1"
          :disabled="activeSession()?.streaming"
          @keydown.enter="handleInputEnter"
        ></textarea>
        <button
          v-if="activeSession()?.streaming"
          class="stop-btn"
          @click="handleCancel"
        >
          Stop
        </button>
        <button
          v-else
          class="send-btn"
          :disabled="inputText.trim().length === 0"
          @click="handleSend"
        >
          Send
        </button>
      </div>
    </div>

    <!-- Empty -->
    <div v-else class="empty-chat">
      <p class="empty-title">Select or create a chat</p>
      <p class="empty-sub">Your AI conversations appear here.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import { useChat } from '../composables/useChat';
import { renderMarkdownSafe } from '../utils/renderContent';
import type { ChatMessageEvent } from '../../preload/index';

const {
  sessions, activeSessionId, activeSession,
  createSession, sendMessage, handleStreamEvent,
} = useChat();

const inputText = ref('');
const messageListRef = ref<HTMLElement | null>(null);
let unsubscribeChat: (() => void) | null = null;

onMounted(() => {
  unsubscribeChat = window.aesyclaw.onChatMessage((event: ChatMessageEvent) => {
    handleStreamEvent(event);
    scrollToBottom();
  });
});

onUnmounted(() => { unsubscribeChat?.(); });

function handleSend() {
  const text = inputText.value.trim();
  if (!text || activeSession()?.streaming) return;
  sendMessage(text);
  inputText.value = '';
}

function handleInputEnter(event: KeyboardEvent) {
  if (event.shiftKey || event.isComposing) return;
  event.preventDefault();
  handleSend();
}

function handleCancel() {
  const session = activeSession();
  if (session) window.aesyclaw.cancelChat(session.id);
}

function scrollToBottom() {
  nextTick(() => {
    const el = messageListRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}
</script>

<style scoped>
.chat-view {
  display: flex;
  height: 100%;
}

/* ── Session list ────────────────────── */
.session-list {
  width: 240px;
  background: #f8f5f0;
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
  padding: 16px;
  flex-shrink: 0;
}

.new-chat-btn {
  width: 100%;
  padding: 10px 16px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 12px;
  transition: background var(--transition-fast);
}
.new-chat-btn:hover { background: var(--color-primary-hover); }

.session-item {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--color-mid-gray);
  font-family: var(--font-body);
  transition: all var(--transition-fast);
}
.session-item:hover { background: rgba(20,20,19,0.04); color: var(--color-dark); }
.session-item.active { background: #f7f0ea; color: var(--color-dark); }

.session-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-badge { color: var(--color-primary); font-weight: 500; }

.empty-sessions {
  text-align: center;
  color: var(--color-mid-gray);
  font-style: italic;
  font-size: 13px;
  margin-top: 32px;
}

/* ── Chat area ───────────────────────── */
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}

.empty-state, .empty-chat {
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
.message { margin-bottom: 20px; }

.user-msg { display: flex; justify-content: flex-end; }

.user-bubble {
  max-width: 70%;
  padding: 10px 16px;
  border-radius: var(--radius);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.6;
  background: var(--color-primary);
  color: #fff;
}

.assistant-bubble {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: var(--radius);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-dark);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}

.rendered-content { overflow-wrap: anywhere; }
.rendered-content :deep(*) { max-width: 100%; }
.rendered-content :deep(p) { margin: 0 0 0.75em; }
.rendered-content :deep(p:last-child) { margin-bottom: 0; }
.rendered-content :deep(ul),
.rendered-content :deep(ol) { margin: 0.4em 0 0.75em; padding-left: 1.35em; }
.rendered-content :deep(blockquote) {
  margin: 0.75em 0;
  padding-left: 1em;
  border-left: 3px solid var(--color-border);
  color: var(--color-mid-gray);
}
.rendered-content :deep(a) { color: var(--color-primary); }
.rendered-content :deep(code) {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 0.92em;
  background: rgba(20, 20, 19, 0.06);
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
.rendered-content :deep(pre) {
  margin: 0.75em 0;
  padding: 12px;
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #f8f5f0;
}
.rendered-content :deep(pre code) {
  display: block;
  padding: 0;
  background: transparent;
  white-space: pre;
}
.rendered-content :deep(table) {
  border-collapse: collapse;
  margin: 0.75em 0;
  font-size: 13px;
}
.rendered-content :deep(th),
.rendered-content :deep(td) {
  border: 1px solid var(--color-border);
  padding: 6px 8px;
}
.rendered-content :deep(img) {
  display: block;
  max-height: 320px;
  border-radius: var(--radius-sm);
}
.assistant-bubble.streaming {
  border-left: 3px solid var(--color-primary);
}
.assistant-bubble.dim {
  color: var(--color-mid-gray);
  font-style: italic;
}

.cursor {
  animation: blink 1s step-end infinite;
  color: var(--color-primary);
}
@keyframes blink { 50% { opacity: 0; } }

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

/* ── Tool cards ──────────────────────── */
.tool-block { display: flex; }

.tool-card {
  margin: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--color-surface);
  max-width: 85%;
}
.tool-card.error { border-color: rgba(196, 91, 91, 0.4); }

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
}
.tool-card-header:hover { background: rgba(20,20,19,0.03); }

.tool-arrow { font-size: 10px; width: 14px; color: var(--color-mid-gray); }

.tool-status-dot {
  width: 7px; height: 7px; border-radius: 50%;
}
.tool-status-dot.running { background: var(--color-warning); }
.tool-status-dot.done { background: var(--color-accent-green); }
.tool-status-dot.error { background: var(--color-danger); }

.tool-card-body {
  padding: 10px 12px;
  border-top: 1px solid var(--color-border);
}

.tool-section { margin-bottom: 10px; }
.tool-section:last-child { margin-bottom: 0; }

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

/* ── Input ───────────────────────────── */
.input-area {
  display: flex;
  align-items: flex-end;
  padding: 16px 24px;
  border-top: 1px solid var(--color-border);
  gap: 10px;
  background: #fdfbf9;
}

.chat-input {
  flex: 1;
  min-height: 42px;
  max-height: 160px;
  padding: 10px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--color-dark);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.5;
  outline: none;
  resize: vertical;
  transition: border var(--transition-fast);
}
.chat-input:focus { border-color: var(--color-primary); }
.chat-input:disabled { background: #f5f3ef; }

.send-btn,
.stop-btn {
  min-width: 76px;
  height: 42px;
  padding: 10px 18px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 13px;
  font-weight: 500;
  transition: all var(--transition-fast);
}

.send-btn {
  background: var(--color-primary);
  color: #fff;
  border: 1px solid var(--color-primary);
}
.send-btn:hover:not(:disabled) { background: var(--color-primary-hover); }
.send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.stop-btn {
  background: transparent;
  color: var(--color-danger);
  border: 1px solid rgba(196, 91, 91, 0.4);
}
.stop-btn:hover {
  background: var(--color-danger);
  color: #fff;
}
</style>
