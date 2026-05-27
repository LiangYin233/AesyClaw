<template>
  <div class="chat-view">
    <SessionList
      :sessions="sessions"
      :activeSessionId="activeSessionId"
      :createSession="createSession"
      @delete-session="deleteSession"
      :selectSession="selectSession"
    />

    <!-- Chat area -->
    <!-- Chat area -->
    <div class="chat-area" v-if="activeSession">
      <div class="context-bar" v-if="contextUsage">
        <div class="context-track">
          <div
            class="context-fill"
            :style="{ width: Math.min(contextUsage.percentage, 100) + '%' }"
            :class="{ warning: contextUsage.percentage > 70, danger: contextUsage.percentage > 90 }"
          ></div>
        </div>
        <span class="context-label">{{ contextUsage.percentage }}% ({{ contextUsage.estimatedTokens }} / {{ contextUsage.contextWindow }})</span>
      </div>
      <MessageList
        :messages="activeSession.messages ?? []"
        :activeSession="activeSession"
        :activeCopyMenuIndex="activeCopyMenuIndex"
        @toggle-copy-menu="toggleCopyMenu"
        @close-copy-menu="closeCopyMenu"
      />
      <ChatInput
        :commands="commands"
        :streaming="!!activeSession?.streaming"
        @send="onSend"
        @cancel="onCancel"
      />
    </div>

    <!-- Empty -->
    <div v-else class="empty-chat">
      <p class="empty-title">Select or create a chat</p>
      <p class="empty-sub">Your AI conversations appear here.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { useChat } from '../composables/useChat';
import type { ChatMessageEvent, DesktopUploadFile } from '../../preload/index';
import SessionList from '../components/SessionList.vue';
import ChatInput from '../components/ChatInput.vue';
import MessageList from '../components/MessageList.vue';

const {
  sessions,
  activeSessionId,
  activeSession,
  createSession,
  syncSessionsFromBackend,
  loadSessionMessages,
  sendMessage,
  handleStreamEvent,
} = useChat();
const contextUsage = ref<{ estimatedTokens: number; contextWindow: number; percentage: number } | null>(null);
const commands = ref<Array<{ name: string; description: string }>>([]);

let unsubscribeChat: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;
let unsubscribeCommands: (() => void) | null = null;
const activeCopyMenuIndex = ref<number | null>(null);

onMounted(() => {
  unsubscribeStatus = window.aesyclaw.onStatusChange((status) => {
    if (status.admin === 'connected') {
      void syncAndLoadActiveSession();
    }
  });

  void syncAndLoadActiveSession();

  unsubscribeChat = window.aesyclaw.onChatMessage((event: ChatMessageEvent) => {
    handleStreamEvent(event);
    if (event.type === 'done') {
      void syncSessionsFromBackend();
      void fetchContextUsage();
    }
  });

  unsubscribeCommands = window.aesyclaw.onCommands((cmds) => {
    commands.value = cmds;
  });
  void loadCommands();

  document.addEventListener('click', closeCopyMenu);
});

onUnmounted(() => {
  unsubscribeChat?.();
  unsubscribeStatus?.();
  unsubscribeCommands?.();
  document.removeEventListener('click', closeCopyMenu);
});

async function syncAndLoadActiveSession() {
  await syncSessionsFromBackend();
  if (activeSessionId.value) await loadSessionMessages(activeSessionId.value);
}

function selectSession(sessionId: string) {
  activeSessionId.value = sessionId;
  void loadSessionMessages(sessionId);
}

function onSend(
  text: string,
  files: DesktopUploadFile[],
  attachments: { name: string; mime: string; size: number }[],
) {
  void sendMessage(text, files, attachments);
}

function onCancel() {
  const session = activeSession.value;
  if (session) window.aesyclaw.cancelChat(session.id);
}

function toggleCopyMenu(index: number): void {
  activeCopyMenuIndex.value = activeCopyMenuIndex.value === index ? null : index;
}

function closeCopyMenu(): void {
  activeCopyMenuIndex.value = null;
}

async function loadCommands(): Promise<void> {
  commands.value = await window.aesyclaw.getCommands();
}

async function deleteSession(sessionId: string) {
  selectSession(sessionId);
  await nextTick();
  await sendMessage('/clear delete', [], []);
}

/** 获取当前会话的上下文窗口使用率 */
async function fetchContextUsage(): Promise<void> {
  const session = activeSession.value;
  if (!session) {
    contextUsage.value = null;
    return;
  }
  // 通过 adminRequest 获取 backend summary 中的 database sessionId
  const sessionsRes = await window.aesyclaw.adminRequest('get_sessions');
  if (!sessionsRes.ok || !Array.isArray(sessionsRes.data)) return;
  const backend = (sessionsRes.data as Array<{ id: string; chatId: string }>).find(
    (s) => s.chatId === session.id,
  );
  if (!backend) return;
  const res = await window.aesyclaw.adminRequest('get_session_context', {
    sessionId: backend.id,
  });
  if (res.ok && res.data) {
    contextUsage.value = res.data as {
      estimatedTokens: number;
      contextWindow: number;
      percentage: number;
    };
  }
}

// 会话切换时刷新
watch(activeSessionId, () => {
  void fetchContextUsage();
});
</script>

<style scoped>
.chat-view {
  display: flex;
  height: 100%;
}

/* ── Chat area ───────────────────────── */
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.empty-chat {
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

.context-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 32px;
  background: #faf8f3;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.context-track {
  flex: 1;
  max-width: 200px;
  height: 6px;
  background: #e6e0d4;
  border-radius: 3px;
  overflow: hidden;
}
.context-fill {
  height: 100%;
  background: var(--color-accent-green);
  border-radius: 3px;
  transition: width 0.3s ease;
}
.context-fill.warning {
  background: #d4a84b;
}
.context-fill.danger {
  background: #c45b5b;
}
.context-label {
  font-family: var(--font-heading);
  font-size: 11px;
  color: var(--color-mid-gray);
  white-space: nowrap;
}
.context-bar + .message-list {
  padding-top: 8px;
}
.chat-area:deep(.message-list) {
  padding-top: 4px;
}
.context-bar ~ .message-list {
  padding-top: 4px;
}
</style>
