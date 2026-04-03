<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import AppLayout from '../components/AppLayout.vue';
import { agentsApi } from '../lib/api';
import { useWebSocket } from '../lib/ws';

interface RuntimeEvent {
  chatId: string;
  event: 'thinking' | 'tool_call' | 'tool_result' | 'response' | 'error';
  detail?: {
    tool?: string;
    args?: string;
    result?: string;
    text?: string;
    error?: string;
  };
  timestamp: number;
}

const { connected, connect, disconnect } = useWebSocket();

const events = ref<RuntimeEvent[]>([]);
const activeChats = ref<{ chatId: string }[]>([]);
const selectedChatId = ref<string | null>(null);
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    const stats = await agentsApi.getStats();
    activeChats.value = stats.agents.map((a) => ({ chatId: a.chatId }));
    if (activeChats.value.length > 0) {
      selectedChatId.value = activeChats.value[0].chatId;
    }
  } catch (err) {
    console.error(err);
  } finally {
    loading.value = false;
  }

  connect(handleMessage);
});

onUnmounted(() => {
  disconnect();
});

function handleMessage(msg: any) {
  if (msg.type === 'runtime_trace' && msg.chatId) {
    const event: RuntimeEvent = {
      chatId: msg.chatId,
      event: msg.event,
      detail: msg.detail,
      timestamp: msg.timestamp,
    };

    events.value.push(event);

    if (events.value.length > 100) {
      events.value = events.value.slice(-100);
    }
  }
}

function clearEvents() {
  events.value = [];
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function getEventIcon(event: string): string {
  switch (event) {
    case 'thinking': return '🧠';
    case 'tool_call': return '🔧';
    case 'tool_result': return '✅';
    case 'response': return '💬';
    case 'error': return '❌';
    default: return '📝';
  }
}

function getEventColor(event: string): string {
  switch (event) {
    case 'thinking': return 'border-l-blue-500 bg-blue-900/20';
    case 'tool_call': return 'border-l-purple-500 bg-purple-900/20';
    case 'tool_result': return 'border-l-green-500 bg-green-900/20';
    case 'response': return 'border-l-yellow-500 bg-yellow-900/20';
    case 'error': return 'border-l-red-500 bg-red-900/20';
    default: return 'border-l-gray-500 bg-gray-900/20';
  }
}

function getEventLabel(event: string): string {
  switch (event) {
    case 'thinking': return 'LLM Thinking...';
    case 'tool_call': return 'Tool Call';
    case 'tool_result': return 'Tool Result';
    case 'response': return 'Final Response';
    case 'error': return 'Error';
    default: return event;
  }
}
</script>

<template>
  <AppLayout>
    <div class="h-full flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-800">
        <div>
          <h1 class="text-lg font-semibold text-white">Agent Runtime</h1>
          <p class="text-sm text-gray-400">Linear Call Trace</p>
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
            @click="clearEvents"
            class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Clear Trace
          </button>
        </div>
      </div>

      <!-- Call Trace Timeline -->
      <div class="flex-1 overflow-y-auto p-6">
        <div v-if="events.length === 0" class="flex flex-col items-center justify-center h-full text-gray-400">
          <svg class="w-16 h-16 text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p class="text-lg">No runtime events yet</p>
          <p class="text-sm mt-2">Start a conversation to see the call trace</p>
        </div>

        <div v-else class="space-y-3 max-w-4xl mx-auto">
          <div
            v-for="(event, index) in events"
            :key="index"
            :class="[
              'border-l-4 rounded-r-lg p-4 transition-all',
              getEventColor(event.event)
            ]"
          >
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-3">
                <span class="text-2xl">{{ getEventIcon(event.event) }}</span>
                <div>
                  <span class="font-medium text-white">{{ getEventLabel(event.event) }}</span>
                  <span class="ml-2 text-sm text-gray-400">{{ event.chatId }}</span>
                </div>
              </div>
              <span class="text-sm text-gray-500">{{ formatTime(event.timestamp) }}</span>
            </div>

            <!-- Event Details -->
            <div class="mt-3 pl-9 space-y-2">
              <div v-if="event.event === 'thinking'" class="flex items-center gap-2">
                <div class="flex gap-1">
                  <span class="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></span>
                  <span class="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 0.1s"></span>
                  <span class="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></span>
                </div>
                <span class="text-sm text-blue-300">Processing request...</span>
              </div>

              <div v-else-if="event.event === 'tool_call' && event.detail" class="bg-gray-900/50 rounded-lg p-3">
                <p class="text-sm text-gray-300">
                  <span class="text-purple-400 font-medium">Tool:</span> {{ event.detail.tool }}
                </p>
                <p v-if="event.detail.args" class="text-sm text-gray-400 mt-1">
                  <span class="text-gray-500">Args:</span> {{ event.detail.args }}
                </p>
              </div>

              <div v-else-if="event.event === 'tool_result' && event.detail" class="bg-gray-900/50 rounded-lg p-3">
                <p class="text-sm text-gray-300">
                  <span class="text-green-400 font-medium">{{ event.detail.tool }}:</span>
                </p>
                <p class="text-sm text-gray-400 mt-1">
                  {{ event.detail.result?.substring(0, 200) }}{{ event.detail.result?.length > 200 ? '...' : '' }}
                </p>
              </div>

              <div v-else-if="event.event === 'response' && event.detail" class="bg-gray-900/50 rounded-lg p-3">
                <p class="text-sm text-gray-300 whitespace-pre-wrap">
                  {{ event.detail.text?.substring(0, 500) }}{{ event.detail.text?.length > 500 ? '...' : '' }}
                </p>
              </div>

              <div v-else-if="event.event === 'error' && event.detail" class="bg-red-900/30 rounded-lg p-3">
                <p class="text-sm text-red-300">{{ event.detail.error }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
