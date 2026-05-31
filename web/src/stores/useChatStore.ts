/**
 * 聊天状态管理 Store
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { chatService, type Message } from '@/services/chatService';

export const useChatStore = defineStore('chat', () => {
  // State
  const messages = ref<Map<string, Message[]>>(new Map());
  const streamingMessages = ref<Map<string, string>>(new Map());
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const getMessages = computed(() => (sessionId: string) => {
    return messages.value.get(sessionId) || [];
  });

  const getStreamingMessage = computed(() => (sessionId: string) => {
    return streamingMessages.value.get(sessionId) || '';
  });

  const hasMessages = computed(() => (sessionId: string) => {
    const msgs = messages.value.get(sessionId);
    return msgs && msgs.length > 0;
  });

  // Actions
  async function loadMessages(sessionId: string, limit = 50) {
    loading.value = true;
    error.value = null;
    try {
      const msgs = await chatService.getMessages(sessionId, limit);
      messages.value.set(sessionId, msgs);
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load messages';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function sendMessage(sessionId: string, content: string, role?: string) {
    loading.value = true;
    error.value = null;
    try {
      const message = await chatService.sendMessage({ sessionId, content, role });
      addMessage(sessionId, message);
      return message;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to send message';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function clearHistory(sessionId: string) {
    loading.value = true;
    error.value = null;
    try {
      await chatService.clearHistory(sessionId);
      messages.value.delete(sessionId);
      streamingMessages.value.delete(sessionId);
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to clear history';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  function addMessage(sessionId: string, message: Message) {
    const msgs = messages.value.get(sessionId) || [];
    messages.value.set(sessionId, [...msgs, message]);
  }

  function updateStreamingMessage(sessionId: string, content: string) {
    streamingMessages.value.set(sessionId, content);
  }

  function clearStreamingMessage(sessionId: string) {
    streamingMessages.value.delete(sessionId);
  }

  function clearMessages(sessionId: string) {
    messages.value.delete(sessionId);
    streamingMessages.value.delete(sessionId);
  }

  function clearAllMessages() {
    messages.value.clear();
    streamingMessages.value.clear();
  }

  // Setup message listeners
  function setupListeners() {
    chatService.onMessage((message) => {
      const msg = message as Message;
      if (msg.sessionId) {
        addMessage(msg.sessionId, msg);
      }
    });

    chatService.onStreamChunk((chunk) => {
      updateStreamingMessage(chunk.sessionId, chunk.content);
    });
  }

  // Cleanup listeners
  function cleanupListeners() {
    // Note: We need to store the handler references to properly remove them
    // This is a simplified version - in production, you'd want to store the handlers
  }

  return {
    // State
    messages,
    streamingMessages,
    loading,
    error,

    // Getters
    getMessages,
    getStreamingMessage,
    hasMessages,

    // Actions
    loadMessages,
    sendMessage,
    clearHistory,
    addMessage,
    updateStreamingMessage,
    clearStreamingMessage,
    clearMessages,
    clearAllMessages,
    setupListeners,
    cleanupListeners,
  };
});
