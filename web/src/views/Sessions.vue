<template>
  <div>
    <h1 class="page-title">Sessions</h1>
    <p class="page-subtitle">View and manage active and historical chat sessions.</p>

    <div class="overflow-x-auto rounded border border-[var(--color-border)]">
      <table class="w-full border-collapse separate font-body text-sm">
        <thead>
          <tr>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              style="width: 40px"
            ></th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Session ID
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Channel
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Type
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Chat ID
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Last Activity
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              style="width: 40px"
            ></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="session in sessions" :key="session.id">
            <tr
              class="cursor-pointer bg-[#FDFBF9] transition-colors duration-[0.15s] ease hover:bg-[rgba(20,20,19,0.03)]"
              @click="toggleSession(session.id)"
            >
              <td class="px-4 py-3 border-b border-[var(--color-border)]">
                <ChevronRightIcon
                  class="w-[14px] h-[14px] text-mid-gray transition-transform duration-[0.2s] ease shrink-0"
                  :class="{ 'rotate-90': expanded === session.id }"
                />
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)]">{{ session.id }}</td>
              <td class="px-4 py-3 border-b border-[var(--color-border)]">
                <div class="flex items-center gap-1.5">
                  <ChatBubbleLeftRightIcon class="w-[14px] h-[14px] text-mid-gray" />
                  <span>{{ session.channel }}</span>
                </div>
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)]">{{ session.type }}</td>
              <td class="px-4 py-3 border-b border-[var(--color-border)]">{{ session.chatId }}</td>
              <td class="px-4 py-3 border-b border-[var(--color-border)] text-mid-gray">
                {{ formatDate(session.lastActivity) }}
              </td>
              <td
                class="relative px-4 py-3 border-b border-[var(--color-border)] text-right"
                style="width: 40px"
              >
                <button
                  class="bg-none border-none cursor-pointer text-mid-gray p-1 flex items-center justify-center rounded transition-all duration-[0.15s] ease hover:bg-light-gray hover:text-dark"
                  @click.stop="toggleSessionMenu(session.id)"
                >
                  <EllipsisHorizontalIcon class="w-4 h-4" />
                </button>
                <div
                  v-if="openMenuSessionId === session.id"
                  class="absolute right-4 mt-1 z-20 min-w-[150px] rounded-sm border border-[var(--color-border)] bg-light shadow-lg py-1 text-left"
                  @click.stop
                >
                  <button
                    class="w-full px-3 py-2 text-left font-body text-sm text-danger bg-transparent border-none cursor-pointer hover:bg-light-gray"
                    @click="clearSession(session.id)"
                  >
                    Clear history
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="expanded === session.id" class="bg-[rgba(20,20,19,0.02)]">
              <td colspan="7">
                <div class="p-5">
                  <div class="flex items-center justify-between mb-3">
                    <h4 class="font-heading text-sm font-semibold text-dark m-0">
                      Message History
                    </h4>
                    <button
                      class="inline-flex items-center gap-1.5 px-2.5 py-[0.35rem] border border-[var(--color-border)] rounded-sm bg-transparent text-mid-gray font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease hover:bg-light-gray hover:text-dark"
                      @click="collapseSession"
                    >
                      <ChevronUpIcon class="w-[14px] h-[14px]" />
                      Collapse
                    </button>
                  </div>

                  <div class="border border-[var(--color-border)] rounded-sm overflow-hidden mb-3">
                    <div
                      v-if="messagesLoading"
                      class="py-8 text-center text-mid-gray font-body text-sm"
                    >
                      Loading...
                    </div>
                    <div
                      v-else-if="messages.length === 0"
                      class="py-8 text-center text-mid-gray font-body text-sm"
                    >
                      No messages
                    </div>
                    <div v-else class="flex flex-col gap-3 p-4 max-h-[480px] overflow-y-auto">
                      <div
                        v-for="(item, idx) in displayMessages"
                        :key="'d' + idx"
                        class="flex flex-col max-w-[85%]"
                        :class="
                          item.kind === 'msg' && item.role === 'user' ? 'self-end' : 'self-start'
                        "
                      >
                        <div v-if="item.kind === 'msg'">
                          <div
                            class="flex items-center gap-2 mb-1"
                            :class="item.role === 'user' ? 'flex-row-reverse' : ''"
                          >
                            <span
                              class="inline-flex items-center px-2 py-[0.15rem] rounded font-heading text-[0.7rem] font-medium lowercase"
                              :class="
                                item.role === 'user'
                                  ? 'bg-[rgba(106,155,204,0.12)] text-[#4a7aa8]'
                                  : 'bg-[rgba(120,140,93,0.12)] text-[#5a6e47]'
                              "
                            >
                              {{ item.role }}
                            </span>
                            <span class="font-heading text-[0.7rem] text-mid-gray">{{
                              formatTime(item.timestamp)
                            }}</span>
                          </div>
                          <div
                            class="py-2.5 px-3 rounded-sm font-body text-sm leading-relaxed text-dark break-words border border-[var(--color-border)]"
                            :class="item.role === 'user' ? 'bg-light-gray' : 'bg-surface'"
                          >
                            {{ item.content }}
                          </div>
                        </div>
                        <div v-if="item.kind === 'tool'">
                          <div
                            class="border border-[var(--color-border)] rounded-sm overflow-hidden bg-surface"
                            :class="{ 'border-[rgba(196,91,91,0.4)]': item.error }"
                          >
                            <div
                              class="flex items-center gap-2 px-3 py-2 cursor-pointer select-none font-heading text-xs text-mid-gray transition-colors duration-[0.15s] ease hover:bg-[rgba(20,20,19,0.03)]"
                              @click="toggleToolDetail('t' + idx)"
                            >
                              <span
                                class="text-[10px] w-3 shrink-0 transition-transform duration-[0.2s] ease"
                                :class="{ 'rotate-90': toolDetailExpanded === 't' + idx }"
                                >&#9658;</span
                              >
                              <span
                                class="w-[7px] h-[7px] rounded-full shrink-0"
                                :class="
                                  item.error
                                    ? 'bg-[var(--color-danger)]'
                                    : 'bg-[var(--color-accent-green)]'
                                "
                              ></span>
                              <span>{{ item.name }}</span>
                            </div>
                            <div
                              v-if="toolDetailExpanded === 't' + idx"
                              class="border-t border-[var(--color-border)] p-3 flex flex-col gap-3"
                            >
                              <div>
                                <div
                                  class="font-heading text-[10px] font-semibold text-mid-gray uppercase tracking-[0.06em] mb-1.5"
                                >
                                  Args
                                </div>
                                <pre
                                  class="font-mono text-xs text-dark whitespace-pre-wrap break-all max-h-[180px] overflow-y-auto m-0 leading-relaxed"
                                  >{{ JSON.stringify(item.args, null, 2) }}</pre
                                >
                              </div>
                              <div v-if="item.result !== undefined">
                                <div
                                  class="font-heading text-[10px] font-semibold text-mid-gray uppercase tracking-[0.06em] mb-1.5"
                                >
                                  Result
                                </div>
                                <pre
                                  class="font-mono text-xs text-dark whitespace-pre-wrap break-all max-h-[180px] overflow-y-auto m-0 leading-relaxed bg-[rgba(20,20,19,0.02)] rounded p-2"
                                  >{{ item.result || '(empty)' }}</pre
                                >
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="flex items-center justify-between pt-2">
                    <span class="font-heading text-xs font-medium text-dark"
                      >{{ msgCount }} messages</span
                    >
                    <span class="font-body text-xs text-mid-gray">
                      Started: {{ formatTime(firstMsgTimestamp) }}
                      <span v-if="displayMessages.length > 0">
                        &middot; Last activity:
                        {{
                          formatTime(displayMessages[displayMessages.length - 1]?.timestamp)
                        }}</span
                      >
                    </span>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="sessions.length === 0">
            <td colspan="7" class="text-mid-gray text-center py-10 font-body italic text-sm">
              No sessions
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useWebSocket } from '@/composables/useWebSocket';
import {
  ChevronRightIcon,
  ChatBubbleLeftRightIcon,
  EllipsisHorizontalIcon,
  ChevronUpIcon,
} from '@heroicons/vue/24/outline';
import type { Session, PersistableMessage } from '@/types/api';

const ws = useWebSocket();

const sessions = ref<Session[]>([]);
const expanded = ref<string | null>(null);
const messages = ref<PersistableMessage[]>([]);
const messagesLoading = ref(false);
const openMenuSessionId = ref<string | null>(null);
const toolDetailExpanded = ref<string | null>(null);

async function loadSessions() {
  try {
    const data = await ws.send('get_sessions');
    sessions.value = Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Failed to load sessions', err);
  }
}

async function toggleSession(id: string) {
  openMenuSessionId.value = null;
  if (expanded.value === id) {
    collapseSession();
    return;
  }
  expanded.value = id;
  messagesLoading.value = true;
  messages.value = [];
  try {
    const data = await ws.send('get_messages', { sessionId: id });
    if (expanded.value !== id) return;
    messages.value = Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Failed to load messages', err);
  } finally {
    if (expanded.value === id) {
      messagesLoading.value = false;
    }
  }
}

function toggleSessionMenu(id: string) {
  openMenuSessionId.value = openMenuSessionId.value === id ? null : id;
}

async function clearSession(id: string) {
  openMenuSessionId.value = null;
  await ws.send('clear_session', { sessionId: id });
  if (expanded.value === id) {
    messages.value = [];
  }
  await loadSessions();
}

function collapseSession() {
  expanded.value = null;
  messages.value = [];
  messagesLoading.value = false;
  openMenuSessionId.value = null;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) +
    ' ' +
    d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  );
}

function toggleToolDetail(key: string | number): void {
  const k = String(key);
  toolDetailExpanded.value = toolDetailExpanded.value === k ? null : k;
}

type ToolCallShape = { id?: string; name: string; arguments?: Record<string, unknown> };
type ToolResultShape = { toolCallId?: string; toolName?: string; isError?: boolean };

/** 解析 assistant 消息的 toolData（兼容新旧格式） */
function parseToolCalls(toolData: string | undefined): ToolCallShape[] {
  if (!toolData) return [];
  try {
    const parsed = JSON.parse(toolData);
    if (Array.isArray(parsed)) return parsed as ToolCallShape[];
    return (parsed as { toolCalls?: ToolCallShape[] }).toolCalls ?? [];
  } catch {
    return [];
  }
}

/** 解析 toolResult 消息的 toolData */
function parseToolResult(toolData: string | undefined): ToolResultShape {
  if (!toolData) return { isError: false };
  try {
    return JSON.parse(toolData) as ToolResultShape;
  } catch {
    return { isError: false };
  }
}

// ─── 合并后的显示数据模型 ──────────────────────────────────

type DisplayItem =
  | {
      kind: 'msg';
      role: 'user' | 'assistant';
      content: string;
      timestamp?: string;
    }
  | {
      kind: 'tool';
      id: string;
      name: string;
      args: Record<string, unknown>;
      result?: string;
      error: boolean;
      timestamp?: string;
    };

/**
 * 将原始 messages 合并为显示用列表：toolResult 合并到对应的 toolCall 卡片中。
 * 与 Desktop 的 loadSessionMessages 逻辑保持一致。
 */
function buildDisplayMessages(raw: PersistableMessage[]): DisplayItem[] {
  const result: DisplayItem[] = [];
  const toolIndex = new Map<string, DisplayItem & { kind: 'tool' }>();

  for (const msg of raw) {
    const ts = msg.timestamp;

    if (msg.role === 'user') {
      result.push({ kind: 'msg', role: 'user', content: msg.content, timestamp: ts });
      continue;
    }

    if (msg.role === 'assistant') {
      if (!msg.toolData) {
        result.push({ kind: 'msg', role: 'assistant', content: msg.content, timestamp: ts });
        continue;
      }
      if (msg.content) {
        result.push({ kind: 'msg', role: 'assistant', content: msg.content, timestamp: ts });
      }
      for (const tc of parseToolCalls(msg.toolData)) {
        const id = tc.id || tc.name;
        const item: DisplayItem = {
          kind: 'tool',
          id,
          name: tc.name,
          args: tc.arguments ?? {},
          error: false,
          timestamp: ts,
        };
        result.push(item);
        toolIndex.set(id, item as DisplayItem & { kind: 'tool' });
      }
      continue;
    }

    if (msg.role === 'toolResult') {
      const meta = parseToolResult(msg.toolData);
      const callId = meta.toolCallId ?? '';
      const isErr = meta.isError ?? false;
      const existing = toolIndex.get(callId);
      if (existing) {
        existing.result = msg.content;
        existing.error = isErr;
      } else {
        result.push({
          kind: 'tool',
          id: callId,
          name: meta.toolName ?? 'Tool',
          args: {},
          result: msg.content,
          error: isErr,
          timestamp: ts,
        });
      }
      continue;
    }
  }

  return result;
}

const displayMessages = computed(() => buildDisplayMessages(messages.value));

const msgCount = computed(() => displayMessages.value.filter((d) => d.kind === 'msg').length);

const firstMsgTimestamp = computed(() => {
  const first = displayMessages.value.find((d) => d.kind === 'msg');
  return first?.timestamp;
});

onMounted(loadSessions);
</script>
