<template>
  <div>
    <h1 class="page-title">Sessions</h1>
    <p class="page-subtitle">View and manage active and historical chat sessions.</p>

    <div class="card">
      <div class="table-wrap">
        <table class="data-table session-table">
          <thead>
            <tr>
              <th style="width: 40px"></th>
              <th>Session ID</th>
              <th>Channel</th>
              <th>Type</th>
              <th>Chat ID</th>
              <th>Status</th>
              <th style="width: 40px"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="session in sessions" :key="session.id">
              <tr class="row-clickable" @click="toggleSession(session.id)">
                <td>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="expand-chevron"
                    :class="{ expanded: expanded === session.id }"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </td>
                <td>{{ session.id }}</td>
                <td>
                  <div class="channel-cell">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-text-muted);">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <span>{{ session.channel }}</span>
                  </div>
                </td>
                <td>{{ session.type }}</td>
                <td>{{ session.chatId }}</td>
                <td>
                  <span class="status-badge" :class="getStatusClass(session)">
                    <span class="status-dot"></span>
                    {{ getStatusLabel(session) }}
                  </span>
                </td>
                <td>
                  <button class="table-action-btn" @click.stop>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="1"></circle>
                      <circle cx="19" cy="12" r="1"></circle>
                      <circle cx="5" cy="12" r="1"></circle>
                    </svg>
                  </button>
                </td>
              </tr>
              <tr v-if="expanded === session.id" class="expand-row">
                <td colspan="7">
                  <div class="expand-content">
                    <div class="message-history-header">
                      <h4>Message History</h4>
                      <button class="collapse-btn" @click="expanded = null">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="18 15 12 9 6 15"></polyline>
                        </svg>
                        Collapse
                      </button>
                    </div>

                    <div class="message-table-wrap">
                      <table class="data-table message-table">
                        <thead>
                          <tr>
                            <th style="width: 80px">Role</th>
                            <th style="width: 140px">Timestamp</th>
                            <th>Content</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(msg, idx) in messages" :key="messageKey(msg, idx)">
                            <td>
                              <span class="msg-role" :class="msg.role === 'user' ? 'role-user' : 'role-assistant'">
                                {{ msg.role }}
                              </span>
                            </td>
                            <td class="cell-muted">{{ formatTime(msg.timestamp) }}</td>
                            <td>{{ msg.content }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div class="message-history-footer">
                      <span class="footer-count">{{ messages.length }} messages</span>
                      <span class="footer-meta">
                        Started: {{ formatTime(session.startedAt || messages[0]?.timestamp) }}
                        <span v-if="messages.length > 0"> &middot; Last activity: {{ formatTime(messages[messages.length - 1].timestamp) }}</span>
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="sessions.length === 0">
              <td colspan="7" class="empty-state">No sessions</td>
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
  startedAt?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
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
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString();
}

function messageKey(message: Message, index: number): string {
  return `${message.timestamp}:${message.role}:${index}`;
}

function getStatusClass(session: Session): string {
  // 根据 session 索引模拟不同状态
  const idx = sessions.value.indexOf(session);
  if (idx % 5 === 0) return 'status-active';
  if (idx % 5 === 3) return 'status-idle';
  return 'status-completed';
}

function getStatusLabel(session: Session): string {
  const cls = getStatusClass(session);
  if (cls === 'status-active') return 'Active';
  if (cls === 'status-idle') return 'Idle';
  return 'Completed';
}

onMounted(loadSessions);
</script>

<style scoped>
.page-subtitle {
  font-family: var(--font-body);
  font-size: 0.9rem;
  color: var(--color-text-muted);
  margin: 0.25rem 0 1.5rem;
}

.expand-chevron {
  color: var(--color-text-muted);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.expand-chevron.expanded {
  transform: rotate(90deg);
}

.channel-cell {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-family: var(--font-heading);
  font-size: 0.75rem;
  font-weight: 500;
}

.status-badge .status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-active {
  background: rgba(120, 140, 93, 0.12);
  color: #5a6e47;
}
.status-active .status-dot {
  background: var(--color-accent-green);
}

.status-idle {
  background: rgba(217, 119, 87, 0.12);
  color: #b0654a;
}
.status-idle .status-dot {
  background: var(--color-accent-orange);
}

.status-completed {
  background: rgba(176, 174, 165, 0.2);
  color: #8a8880;
}
.status-completed .status-dot {
  background: var(--color-mid-gray);
}

.message-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.message-history-header h4 {
  font-family: var(--font-heading);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-dark);
  margin: 0;
}

.collapse-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-heading);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.collapse-btn:hover {
  background: var(--color-surface);
  color: var(--color-dark);
}

.message-table-wrap {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  margin-bottom: 0.75rem;
}

.message-table {
  font-size: 0.8rem;
}

.message-table th {
  background: var(--color-surface);
  font-size: 0.7rem;
}

.message-table td {
  padding: 0.6rem 0.75rem;
}

.msg-role {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-family: var(--font-heading);
  font-size: 0.7rem;
  font-weight: 500;
  text-transform: lowercase;
}

.role-user {
  background: rgba(106, 155, 204, 0.12);
  color: #4a7aa8;
}

.role-assistant {
  background: rgba(120, 140, 93, 0.12);
  color: #5a6e47;
}

.cell-muted {
  color: var(--color-text-muted);
  font-family: var(--font-heading);
  font-size: 0.75rem;
}

.message-history-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 0.5rem;
}

.footer-count {
  font-family: var(--font-heading);
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-dark);
}

.footer-meta {
  font-family: var(--font-body);
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.table-action-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all var(--transition-fast);
}

.table-action-btn:hover {
  background: var(--color-surface);
  color: var(--color-dark);
}

.session-table .data-table th:last-child,
.session-table .data-table td:last-child {
  text-align: right;
}
</style>
