<template>
  <div>
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Sessions</h2>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Channel</th>
              <th>Type</th>
              <th>Chat ID</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="session in sessions" :key="session.id">
              <tr
                class="row-clickable"
                @click="toggleSession(session.id)"
              >
                <td>{{ session.id }}</td>
                <td>{{ session.channel }}</td>
                <td>{{ session.type }}</td>
                <td>{{ session.chatId }}</td>
              </tr>
              <tr v-if="expanded === session.id" class="expand-row">
                <td colspan="4">
                  <div class="expand-content">
                    <h4 style="margin: 0 0 0.5rem">Messages</h4>
                    <div v-if="messagesLoading" class="empty-state">Loading...</div>
                    <div v-else-if="messages.length === 0" class="empty-state">No messages</div>
                    <div v-else class="message-list">
                      <div
                        v-for="msg in messages"
                        :key="msg.id"
                        class="message-item"
                      >
                        <div class="message-meta">
                          <span class="badge" :class="msg.role === 'user' ? 'badge-green' : 'badge-gray'">
                            {{ msg.role }}
                          </span>
                          <span class="message-time">{{ formatTime(msg.createdAt) }}</span>
                        </div>
                        <pre class="message-text">{{ msg.content }}</pre>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="sessions.length === 0">
              <td colspan="4" class="empty-state">No sessions</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from '@/composables/useAuth';

const { api } = useAuth();

interface Session {
  id: string;
  channel: string;
  type: string;
  chatId: string;
}

interface Message {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

const sessions = ref<Session[]>([]);
const expanded = ref<string | null>(null);
const messages = ref<Message[]>([]);
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
  return new Date(iso).toLocaleString();
}

onMounted(loadSessions);
</script>

<style scoped>
.message-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.message-item {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 0.75rem;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.message-time {
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

.message-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 0.85rem;
  line-height: 1.4;
}
</style>
