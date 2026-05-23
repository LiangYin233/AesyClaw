<template>
  <div class="chat-view">
    <SessionList
      :sessions="sessions"
      :activeSessionId="activeSessionId"
      :createSession="createSession"
      :selectSession="selectSession"
    />

    <!-- Chat area -->
    <div class="chat-area" v-if="activeSession()">
      <MessageList
        :messages="activeSession()!.messages"
        :activeSession="activeSession()"
        :activeCopyMenuIndex="activeCopyMenuIndex"
        @toggle-copy-menu="toggleCopyMenu"
        @close-copy-menu="closeCopyMenu"
      />
      <ChatInput :streaming="!!activeSession()?.streaming" @send="onSend" @cancel="onCancel" />
    </div>

    <!-- Empty -->
    <div v-else class="empty-chat">
      <p class="empty-title">Select or create a chat</p>
      <p class="empty-sub">Your AI conversations appear here.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
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

let unsubscribeChat: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;

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
    if (event.type === 'done') void syncSessionsFromBackend();
  });

  document.addEventListener('click', closeCopyMenu);
});

onUnmounted(() => {
  unsubscribeChat?.();
  unsubscribeStatus?.();
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
  sendMessage(text, files, attachments);
}

function onCancel() {
  const session = activeSession();
  if (session) window.aesyclaw.cancelChat(session.id);
}

function toggleCopyMenu(index: number): void {
  activeCopyMenuIndex.value = activeCopyMenuIndex.value === index ? null : index;
}

function closeCopyMenu(): void {
  activeCopyMenuIndex.value = null;
}
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
</style>
