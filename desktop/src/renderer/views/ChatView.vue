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
            <!-- Tool calls -->
            <div
              v-for="tc in msg.toolCalls"
              :key="tc.toolCallId"
              class="tool-card"
              :class="{ expanded: tc.expanded, error: tc.status === 'error' }"
            >
              <div class="tool-card-header" @click="tc.expanded = !tc.expanded">
                <span class="tool-arrow">{{ tc.expanded ? '▾' : '▸' }}</span>
                <span class="tool-status-dot" :class="tc.status"></span>
                <span class="tool-name">{{ tc.toolName }}</span>
              </div>
              <div v-if="tc.expanded" class="tool-card-body">
                <div class="tool-section">
                  <span class="tool-label">Args</span>
                  <pre>{{ JSON.stringify(tc.args, null, 2) }}</pre>
                </div>
                <div v-if="tc.result !== undefined" class="tool-section">
                  <span class="tool-label">Result</span>
                  <pre>{{ JSON.stringify(tc.result, null, 2) }}</pre>
                </div>
              </div>
            </div>
            <!-- Text -->
            <div v-if="msg.text" class="assistant-bubble">{{ msg.text }}</div>
          </div>

          <!-- System -->
          <div v-else class="system-msg">
            <div class="system-bubble">{{ msg.text }}</div>
          </div>
        </div>

        <!-- Streaming -->
        <div v-if="activeSession()?.streaming" class="message assistant">
          <!-- Live tool calls -->
          <div
            v-for="tc in [...activeSession()!.pendingToolCalls.values()]"
            :key="tc.toolCallId"
            class="tool-card"
            :class="{ expanded: tc.expanded, error: tc.status === 'error' }"
          >
            <div class="tool-card-header" @click="tc.expanded = !tc.expanded">
              <span class="tool-arrow">{{ tc.expanded ? '▾' : '▸' }}</span>
              <span class="tool-status-dot" :class="tc.status"></span>
              <span class="tool-name">{{ tc.toolName }}</span>
            </div>
            <div v-if="tc.expanded" class="tool-card-body">
              <div class="tool-section">
                <span class="tool-label">Args</span>
                <pre>{{ JSON.stringify(tc.args, null, 2) }}</pre>
              </div>
              <div v-if="tc.result !== undefined" class="tool-section">
                <span class="tool-label">Result</span>
                <pre>{{ JSON.stringify(tc.result, null, 2) }}</pre>
              </div>
            </div>
          </div>
          <!-- Streaming text -->
          <div v-if="activeSession()!.streamBuffer" class="assistant-bubble streaming">
            {{ activeSession()!.streamBuffer }}<span class="cursor">|</span>
          </div>
          <div v-else class="assistant-bubble streaming dim">
            Thinking…
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="input-area">
        <input
          v-model="inputText"
          class="chat-input"
          placeholder="Type a message… (Enter to send)"
          :disabled="activeSession()?.streaming"
          @keydown.enter="handleSend"
        />
        <button
          v-if="activeSession()?.streaming"
          class="stop-btn"
          @click="handleCancel"
        >
          Stop
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
  if (!text) return;
  sendMessage(text);
  inputText.value = '';
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
.tool-card {
  margin: 6px 0;
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
  padding: 16px 24px;
  border-top: 1px solid var(--color-border);
  gap: 10px;
  background: #fdfbf9;
}

.chat-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--color-dark);
  font-family: var(--font-body);
  font-size: 14px;
  outline: none;
  transition: border var(--transition-fast);
}
.chat-input:focus { border-color: var(--color-primary); }
.chat-input:disabled { background: #f5f3ef; }

.stop-btn {
  padding: 10px 18px;
  background: transparent;
  color: var(--color-danger);
  border: 1px solid rgba(196, 91, 91, 0.4);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 13px;
  font-weight: 500;
  transition: all var(--transition-fast);
}
.stop-btn:hover {
  background: var(--color-danger);
  color: #fff;
}
</style>
