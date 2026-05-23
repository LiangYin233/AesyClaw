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
    </div>
    <div v-if="sessions.length === 0" class="empty-sessions">No conversations yet</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  sessions: { id: string; title: string; streaming?: boolean }[];
  activeSessionId: string | null;
  createSession: () => void;
  selectSession: (id: string) => void;
}>();
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
</style>
