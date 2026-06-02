/**
 * 会话状态管理 Store
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  sessionService,
  type SessionListItem,
  type SessionDetail,
} from '@/services/sessionService';

export const useSessionStore = defineStore('session', () => {
  // State
  const sessions = ref<SessionListItem[]>([]);
  const currentSessionId = ref<string | null>(null);
  const sessionDetails = ref<Map<string, SessionDetail>>(new Map());
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const currentSession = computed(() => {
    if (currentSessionId.value === null) return null;
    return sessions.value.find((s) => s.id === currentSessionId.value) ?? null;
  });

  const getSessionById = computed(() => (sessionId: string) => {
    return sessions.value.find((s) => s.id === sessionId);
  });

  const getSessionDetail = computed(() => (sessionId: string) => {
    return sessionDetails.value.get(sessionId);
  });

  const sortedSessions = computed(() => {
    return [...sessions.value].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  });

  const sessionCount = computed(() => sessions.value.length);

  // Actions
  async function loadSessions() {
    loading.value = true;
    error.value = null;
    try {
      sessions.value = await sessionService.getSessions();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load sessions';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function loadSessionDetail(sessionId: string) {
    loading.value = true;
    error.value = null;
    try {
      const detail = await sessionService.getSession(sessionId);
      sessionDetails.value.set(sessionId, detail);
      return detail;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load session detail';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function createSession(params: {
    channelId: string;
    chatType: string;
    chatId: string;
    roleId?: string;
  }) {
    loading.value = true;
    error.value = null;
    try {
      const session = await sessionService.createSession(params);
      await loadSessions(); // Reload sessions list
      return session;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create session';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function deleteSession(sessionId: string) {
    loading.value = true;
    error.value = null;
    try {
      await sessionService.deleteSession(sessionId);
      sessions.value = sessions.value.filter((s) => s.id !== sessionId);
      sessionDetails.value.delete(sessionId);
      if (currentSessionId.value === sessionId) {
        currentSessionId.value = null;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete session';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function switchRole(sessionId: string, roleId: string) {
    loading.value = true;
    error.value = null;
    try {
      await sessionService.switchRole(sessionId, roleId);
      // Update local session data
      const session = sessions.value.find((s) => s.id === sessionId);
      if (session !== undefined) {
        session.activeRoleId = roleId;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to switch role';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  function setCurrentSession(sessionId: string | null) {
    currentSessionId.value = sessionId;
  }

  function updateSession(session: SessionListItem) {
    const index = sessions.value.findIndex((s) => s.id === session.id);
    if (index >= 0) {
      sessions.value[index] = session;
    } else {
      sessions.value.push(session);
    }
  }

  function clearSessions() {
    sessions.value = [];
    sessionDetails.value.clear();
    currentSessionId.value = null;
  }

  // Setup session update listeners
  function setupListeners() {
    sessionService.onSessionUpdate((session) => {
      updateSession(session);
    });
  }

  // Cleanup listeners
  function cleanupListeners() {
    // Note: We need to store the handler references to properly remove them
    // This is a simplified version - in production, you'd want to store the handlers
  }

  return {
    // State
    sessions,
    currentSessionId,
    sessionDetails,
    loading,
    error,

    // Getters
    currentSession,
    getSessionById,
    getSessionDetail,
    sortedSessions,
    sessionCount,

    // Actions
    loadSessions,
    loadSessionDetail,
    createSession,
    deleteSession,
    switchRole,
    setCurrentSession,
    updateSession,
    clearSessions,
    setupListeners,
    cleanupListeners,
  };
});
