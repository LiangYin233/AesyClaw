<template>
  <div>
    <h1 class="page-title">Sessions</h1>
    <p class="page-subtitle">View and manage active and historical chat sessions.</p>

    <div class="overflow-x-auto rounded border border-[var(--color-border)]">
      <table class="w-full border-collapse separate font-body text-sm">
        <thead>
          <tr>
            <th class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0" style="width: 40px"></th>
            <th class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0">Session ID</th>
            <th class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0">Channel</th>
            <th class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0">Type</th>
            <th class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0">Chat ID</th>
            <th class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0">Last Activity</th>
            <th class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0" style="width: 40px"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="session in sessions" :key="session.id">
            <tr class="cursor-pointer bg-[#FDFBF9] transition-colors duration-[0.15s] ease hover:bg-[rgba(20,20,19,0.03)]" @click="toggleSession(session.id)">
              <td class="px-4 py-3 border-b border-[var(--color-border)]">
                <ChevronRightIcon class="w-[14px] h-[14px] text-mid-gray transition-transform duration-[0.2s] ease shrink-0" :class="{ 'rotate-90': expanded === session.id }" />
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
              <td class="px-4 py-3 border-b border-[var(--color-border)] text-mid-gray">{{ formatDate(session.updatedAt ?? session.createdAt) }}</td>
              <td class="px-4 py-3 border-b border-[var(--color-border)] text-right" style="width: 40px">
                <button class="bg-none border-none cursor-pointer text-mid-gray p-1 flex items-center justify-center rounded transition-all duration-[0.15s] ease hover:bg-light-gray hover:text-dark" @click.stop>
                  <EllipsisHorizontalIcon class="w-4 h-4" />
                </button>
              </td>
            </tr>
            <tr v-if="expanded === session.id" class="bg-[rgba(20,20,19,0.02)]">
              <td colspan="7">
                <div class="p-5">
                  <div class="flex items-center justify-between mb-3">
                    <h4 class="font-heading text-sm font-semibold text-dark m-0">Message History</h4>
                    <button class="inline-flex items-center gap-1.5 px-2.5 py-[0.35rem] border border-[var(--color-border)] rounded-sm bg-transparent text-mid-gray font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease hover:bg-light-gray hover:text-dark" @click="expanded = null">
                      <ChevronUpIcon class="w-[14px] h-[14px]" />
                      Collapse
                    </button>
                  </div>

                  <div class="border border-[var(--color-border)] rounded-sm overflow-hidden mb-3">
                    <div v-if="messagesLoading" class="py-8 text-center text-mid-gray font-body text-sm">Loading...</div>
                    <div v-else-if="messages.length === 0" class="py-8 text-center text-mid-gray font-body text-sm">No messages</div>
                    <div v-else class="flex flex-col gap-3 p-4 max-h-[480px] overflow-y-auto">
                      <div
                        v-for="(msg, idx) in messages"
                        :key="messageKey(msg, idx)"
                        class="flex flex-col max-w-[85%]"
                        :class="msg.role === 'user' ? 'self-end' : 'self-start'"
                      >
                        <div class="flex items-center gap-2 mb-1"
                          :class="msg.role === 'user' ? 'flex-row-reverse' : ''">
                          <span class="inline-flex items-center px-2 py-[0.15rem] rounded font-heading text-[0.7rem] font-medium lowercase"
                            :class="msg.role === 'user' ? 'bg-[rgba(106,155,204,0.12)] text-[#4a7aa8]' : 'bg-[rgba(120,140,93,0.12)] text-[#5a6e47]'"
                          >
                            {{ msg.role }}
                          </span>
                          <span class="font-heading text-[0.7rem] text-mid-gray">{{ formatTime(msg.timestamp) }}</span>
                        </div>
                        <div class="py-2.5 px-3 rounded-sm font-body text-sm leading-relaxed text-dark break-words border border-[var(--color-border)]"
                          :class="msg.role === 'user' ? 'bg-light-gray' : 'bg-surface'"
                        >
                          {{ msg.content }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="flex items-center justify-between pt-2">
                    <span class="font-heading text-xs font-medium text-dark">{{ messages.length }} messages</span>
                    <span class="font-body text-xs text-mid-gray">
                      Started: {{ formatTime(session.createdAt ?? messages[0]?.timestamp) }}
                      <span v-if="messages.length > 0"> &middot; Last activity: {{ formatTime(messages[messages.length - 1].timestamp) }}</span>
                    </span>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="sessions.length === 0">
            <td colspan="7" class="text-mid-gray text-center py-10 font-body italic text-sm">No sessions</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from '@/composables/useAuth';
import {
  ChevronRightIcon,
  ChatBubbleLeftRightIcon,
  EllipsisHorizontalIcon,
  ChevronUpIcon,
} from '@heroicons/vue/24/outline';
import type { Session, PersistableMessage } from '@/types/api';

const { api } = useAuth();

const sessions = ref<Session[]>([]);
const expanded = ref<string | null>(null);
const messages = ref<PersistableMessage[]>([]);
const messagesLoading = ref(false);

async function loadSessions() {
  try {
    const res = await api.get('/sessions');
    if (res.data.ok) {
      sessions.value = res.data.data;
    }
  } catch (err) {
    console.error('Failed to load sessions', err);
  }
}

async function toggleSession(id: string) {
  if (expanded.value === id) {
    expanded.value = null;
    messages.value = [];
    return;
  }
  expanded.value = id;
  messagesLoading.value = true;
  messages.value = [];
  try {
    const res = await api.get(`/sessions/${id}/messages`);
    if (res.data.ok) {
      messages.value = res.data.data;
    }
  } catch (err) {
    console.error('Failed to load messages', err);
  } finally {
    messagesLoading.value = false;
  }
}

function formatTime(iso: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }) + ' ' + d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function messageKey(message: PersistableMessage, index: number): string {
  return `${message.timestamp}:${message.role}:${index}`;
}

onMounted(loadSessions);
</script>
