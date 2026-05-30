<template>
  <div class="chat-view">
    <SessionList
      :sessions="sessions"
      :activeSessionId="activeSessionId"
      :createSession="createSession"
      @delete-session="deleteSession"
      :selectSession="selectSession"
    />

    <div class="chat-main">
      <!-- Message list / Empty (切换时过渡动画，不影响输入框和状态栏） -->
      <Transition name="chat-area" mode="out-in">
        <MessageList
          v-if="activeSession"
          :key="activeSessionId ?? 'none'"
          :messages="activeSession.messages ?? []"
          :activeSession="activeSession"
          :activeCopyMenuIndex="activeCopyMenuIndex"
          :isLoading="!!activeSession.isLoading"
          @toggle-copy-menu="toggleCopyMenu"
          @close-copy-menu="closeCopyMenu"
        />
        <div v-else class="empty-chat" key="empty">
          <p class="empty-title">Select or create a chat</p>
          <p class="empty-sub">Your AI conversations appear here.</p>
        </div>
      </Transition>
      <ChatInput
        :commands="commands"
        :streaming="!!activeSession?.streaming"
        @send="onSend"
        @cancel="onCancel"
      />
      <Transition name="context-bar" v-if="contextUsage">
        <div class="context-bar">
          <div class="context-track">
            <div class="context-fill-output" :style="{ width: Math.min(contextUsage.outputTokens / contextUsage.contextWindow * 100, 100) + '%', minWidth: contextUsage.outputTokens > 0 ? '4px' : '0px' }"></div>
            <div class="context-fill-input" :style="{ width: Math.min(contextUsage.inputTokens / contextUsage.contextWindow * 100, 100) + '%', minWidth: contextUsage.inputTokens > 0 ? '4px' : '0px' }"></div>
          </div>
          <span class="context-label" v-if="contextUsage.inputTokens || contextUsage.outputTokens">
            {{ contextUsage.inputTokens + contextUsage.outputTokens }} /
            {{ contextUsage.contextWindow }} ({{
              Math.round(
                ((contextUsage.inputTokens + contextUsage.outputTokens) /
                  contextUsage.contextWindow) *
                  100,
              )
            }}%)
          </span>
          <span class="context-extra">
            <span class="context-role" v-if="contextUsage.roleId">{{ contextUsage.roleId }}</span>
            <span class="context-model" v-if="contextUsage.modelId">{{
              shortModel(contextUsage.modelId)
            }}</span>
          </span>
        </div>
      </Transition>
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
  reloadSessionMessages,
  sendMessage,
  handleChannelResponse,
  handleStreamEvent,
} = useChat();
const commands = ref<Array<{ name: string; description: string }>>([]);

let unsubscribeChat: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;
let unsubscribeCommands: (() => void) | null = null;
const activeCopyMenuIndex = ref<number | null>(null);

const contextInputStyle = computed(() => {
  if (!contextUsage.value) return {};
  const pct = contextUsage.value.inputTokens / contextUsage.value.contextWindow * 100;
  return { width: Math.min(pct, 100) + '%', minWidth: contextUsage.value.inputTokens > 0 ? '4px' : '0px' };
});
const contextOutputStyle = computed(() => {
  if (!contextUsage.value) return {};
  const pct = contextUsage.value.outputTokens / contextUsage.value.contextWindow * 100;
  return { width: Math.min(pct, 100) + '%', minWidth: contextUsage.value.outputTokens > 0 ? '4px' : '0px' };
});

const contextUsage = ref<{
  inputTokens: number;
  outputTokens: number;
  contextWindow: number;
  modelId?: string;
  roleId?: string;
} | null>(null);

onMounted(() => {
  unsubscribeStatus = window.aesyclaw.onStatusChange((status) => {
    if (status.admin === 'connected') {
      void syncAndLoadActiveSession();
    }
  });

  void syncAndLoadActiveSession();

  unsubscribeChat = window.aesyclaw.onChatMessage(async (event: ChatMessageEvent) => {
    if (event.type === 'sessions' || event.type === 'session_messages') {
      handleChannelResponse(
        event.type,
        'sessionId' in event ? event.sessionId : undefined,
        'data' in event ? event.data : undefined,
      );
      return;
    }
    handleStreamEvent(event);
    if (event.type === 'context_usage') {
      contextUsage.value = {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        contextWindow: event.contextWindow,
        modelId: event.modelId,
        roleId: event.roleId,
      };
    }
    if (event.type === 'done') {
      await syncSessionsFromBackend();
      // done 后重新加载消息，确保 syncSessionsFromBackend 重建会话后不会丢失最终回复
      const sess = activeSession.value;
      if (activeSessionId.value && sess && !sess.streaming && sess.messages.length === 0) {
        await loadSessionMessages(activeSessionId.value, true);
      }
      void requestContextUsage();
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
  setTimeout(() => void requestContextUsage(), 300);
}

function onSend(
  text: string,
  files: DesktopUploadFile[],
  attachments: { name: string; mime: string; size: number }[],
) {
  void sendMessage(text, files, attachments);
  setTimeout(() => void requestContextUsage(), 500);
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

/** 通过 chat WebSocket 请求上下文使用率（channel_desktop 插件处理） */
function requestContextUsage(): void {
  const session = activeSession.value;
  if (!session) {
    contextUsage.value = null;
    return;
  }
  window.aesyclaw.sendChatRaw('get_context_usage', session.id);
}

/** 截断模型 ID 为简短显示名 */
function shortModel(modelId: string): string {
  return modelId.includes('/') ? (modelId.split('/').pop() ?? modelId) : modelId;
}

// 会话切换时刷新
watch(activeSessionId, () => {
  setTimeout(() => void requestContextUsage(), 300);
});
</script>

<style scoped>
.chat-view {
  display: flex;
  height: 100%;
  position: relative;
  overflow-x: hidden;
}

/* ── Chat area ───────────────────────── */
.chat-main {
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
  min-height: 0;
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

/* ── Context usage bar ──────────────── */
.context-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 24px;
  margin-bottom: 4px;
  background: #fdfbf9;
  flex-shrink: 0;
}

.context-track {
  flex: 1;
  max-width: 200px;
  height: 6px;
  background: #e6e0d4;
  border-radius: 3px;
  overflow: hidden;
  display: flex;
}

.context-fill-input {
  flex-shrink: 0;
  height: 100%;
  background: #4a90d9;
  border-radius: 0 3px 3px 0;
  transition: width 0.3s ease;
}

.context-fill-output {
  flex-shrink: 0;
  height: 100%;
  background: #9b59b6;
  border-radius: 3px 0 0 3px;
  transition: width 0.3s ease;
}

.context-label {
  font-family: var(--font-heading);
  font-size: 11px;
  color: var(--color-mid-gray);
  white-space: nowrap;
}

.context-extra {
  margin-left: auto;
  font-family: var(--font-heading);
  font-size: 11px;
  color: var(--color-dark);
  white-space: nowrap;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.context-role,
.context-model {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.context-role {
  color: var(--color-primary);
}

.context-model {
  color: var(--color-dark);
}

/* ── Transitions ─────────────────────── */
.chat-area-enter-active,
.chat-area-leave-active {
  transition:
    opacity var(--transition),
    transform var(--transition);
}

.chat-area-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.chat-area-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

.context-bar-enter-active,
.context-bar-leave-active {
  transition:
    opacity var(--transition-fast),
    transform var(--transition-fast),
    max-height var(--transition-fast);
}

.context-bar-enter-from,
.context-bar-leave-to {
  opacity: 0;
  transform: translateY(-4px);
  max-height: 0;
}
</style>
