<template>
  <div class="session-list">
    <button class="new-chat-btn" @click="createSession"><span>+</span> New Chat</button>
    <div
      v-for="session in sessions"
      :key="session.id"
      class="session-item"
      :class="{ active: session.id === activeSessionId }"
      @click="selectSession(session.id)"
    >
      <span class="session-title">{{ session.title }}</span>
      <span v-if="session.streaming" class="session-badge">&hellip;</span>
      <button
        type="button"
        class="session-delete-btn"
        title="Delete conversation"
        @click.stop="onDelete(session.id)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M1 1l10 10M11 1L1 11"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
    <div v-if="sessions.length === 0" class="empty-sessions">No conversations yet</div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  sessions: { id: string; title: string; streaming?: boolean }[];
  activeSessionId: string | null;
  createSession: () => void;
  selectSession: (id: string) => void;
}>();

const emit = defineEmits<{
  'delete-session': [id: string];
}>();

function onDelete(id: string) {
  if (window.confirm('Delete this conversation? This cannot be undone.')) {
    emit('delete-session', id);
  }
}
</script>

<style scoped>
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

.new-chat-btn:hover {
  background: var(--color-primary-hover);
}

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

.session-item:hover {
  background: rgba(20, 20, 19, 0.04);
  color: var(--color-dark);
}

.session-item.active {
  background: #f7f0ea;
  color: var(--color-dark);
}

.session-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

min-width: 0;
.session-badge {
  color: var(--color-primary);
  font-weight: 500;
}

.empty-sessions {
  text-align: center;
  color: var(--color-mid-gray);
  font-style: italic;
  font-size: 13px;
  margin-top: 32px;
}

.session-delete-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-mid-gray);
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}

.session-item:hover .session-delete-btn {
  display: inline-flex;
}

.session-delete-btn:hover {
  color: var(--color-danger);
  background: rgba(196, 91, 91, 0.1);
}
</style>
