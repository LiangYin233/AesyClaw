<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '../components/AppLayout.vue';
import { useWebSocket } from '../lib/ws';
import { sessionsApi } from '../lib/api';

const route = useRoute();
const router = useRouter();
const { connected, connect, disconnect, sendChatMessage } = useWebSocket();

const chatId = ref(route.params.chatId as string || `chat-${Date.now()}`);
const messages = ref<Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }>>([]);
const inputText = ref('');
const sending = ref(false);
const streaming = ref(false);
const currentStream = ref('');

if (route.params.chatId) {
  loadHistory();
}

watch(() => route.params.chatId, (newId) => {
  if (newId) {
    chatId.value = newId as string;
    loadHistory();
  }
});

function loadHistory() {
  if (chatId.value && !chatId.value.startsWith('chat-')) {
    sessionsApi.getMemory(chatId.value).then((data) => {
      messages.value = data.messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        timestamp: Date.now(),
      }));
    }).catch(() => {});
  }
}

onMounted(() => {
  connect(handleMessage);
  if (route.params.chatId) {
    router.replace(`/dialogue/${chatId.value}`);
  }
});

onUnmounted(() => {
  disconnect();
});

function handleMessage(msg: any) {
  if (msg.type === 'chat_stream') {
    if (msg.done) {
      if (currentStream.value) {
        messages.value.push({
          role: 'assistant',
          content: currentStream.value,
          timestamp: Date.now(),
        });
        currentStream.value = '';
      }
      streaming.value = false;
      sending.value = false;
    } else {
      streaming.value = true;
      currentStream.value += msg.chunk;
    }
  }
}

function sendMessage() {
  if (!inputText.value.trim() || sending.value) return;

  const text = inputText.value.trim();
  inputText.value = '';

  messages.value.push({
    role: 'user',
    content: text,
    timestamp: Date.now(),
  });

  sending.value = true;
  sendChatMessage(chatId.value, text);
}

function startNewChat() {
  chatId.value = `chat-${Date.now()}`;
  messages.value = [];
  router.push('/dialogue');
}
</script>

<template>
  <AppLayout>
    <div class="h-full flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-800">
        <div>
          <h1 class="text-lg font-semibold text-white">Dialogue</h1>
          <p class="text-sm text-gray-400">Chat ID: {{ chatId }}</p>
        </div>
        <div class="flex items-center gap-4">
          <span
            :class="[
              'px-2 py-1 text-xs font-medium rounded',
              connected ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
            ]"
          >
            {{ connected ? 'Connected' : 'Disconnected' }}
          </span>
          <button
            @click="startNewChat"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            New Chat
          </button>
        </div>
      </div>

      <!-- Messages -->
      <div class="flex-1 overflow-y-auto p-6 space-y-4">
        <div
          v-for="(msg, index) in messages"
          :key="index"
          :class="[
            'max-w-[80%] rounded-lg p-4',
            msg.role === 'user'
              ? 'ml-auto bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-100 border border-gray-700'
          ]"
        >
          <p class="whitespace-pre-wrap">{{ msg.content }}</p>
        </div>

        <!-- Streaming indicator -->
        <div v-if="streaming" class="bg-gray-800 text-gray-100 rounded-lg p-4 border border-gray-700 max-w-[80%]">
          <div class="flex items-center gap-2">
            <div class="animate-pulse">
              <div class="flex gap-1">
                <span class="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></span>
                <span class="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 0.1s"></span>
                <span class="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></span>
              </div>
            </div>
            <span class="text-gray-400 text-sm">AI is thinking...</span>
          </div>
          <p class="mt-2 whitespace-pre-wrap">{{ currentStream }}</p>
        </div>

        <div v-if="messages.length === 0 && !streaming" class="text-center text-gray-400 py-12">
          <p>Start a conversation by typing a message below</p>
        </div>
      </div>

      <!-- Input -->
      <div class="p-4 border-t border-gray-700 bg-gray-800">
        <form @submit.prevent="sendMessage" class="flex gap-4">
          <input
            v-model="inputText"
            type="text"
            placeholder="Type your message..."
            class="flex-1 px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            :disabled="sending"
          />
          <button
            type="submit"
            :disabled="!inputText.trim() || sending"
            class="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  </AppLayout>
</template>
