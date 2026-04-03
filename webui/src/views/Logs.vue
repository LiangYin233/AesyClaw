<script setup lang="ts">
import { ref, computed } from 'vue';
import AppLayout from '../components/AppLayout.vue';

interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  context?: Record<string, unknown>;
}

const logs = ref<LogEntry[]>([]);
const filter = ref<'all' | 'info' | 'warn' | 'error'>('all');
const autoScroll = ref(true);

const filteredLogs = computed(() => {
  if (filter.value === 'all') return logs.value;
  return logs.value.filter((log) => log.level === filter.value);
});

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function getLevelColor(level: string): string {
  switch (level) {
    case 'error': return 'text-red-400 bg-red-900/20';
    case 'warn': return 'text-yellow-400 bg-yellow-900/20';
    case 'debug': return 'text-gray-400 bg-gray-900/20';
    default: return 'text-blue-400 bg-blue-900/20';
  }
}

function clearLogs() {
  logs.value = [];
}

// Simulated log generation for demo
function addDemoLog() {
  const levels: Array<'info' | 'warn' | 'error'> = ['info', 'warn', 'error'];
  const messages = [
    'Agent processing request',
    'Tool execution completed',
    'Memory compression triggered',
    'Session created',
    'Configuration reloaded',
    'Database query executed',
    'WebSocket client connected',
  ];

  const level = levels[Math.floor(Math.random() * levels.length)];
  const message = messages[Math.floor(Math.random() * messages.length)];

  logs.value.push({
    timestamp: Date.now(),
    level,
    message,
    context: { traceId: `trace-${Math.random().toString(36).substring(7)}` },
  });

  if (logs.value.length > 100) {
    logs.value = logs.value.slice(-100);
  }
}

// Auto-generate demo logs
setInterval(addDemoLog, 3000);
</script>

<template>
  <AppLayout>
    <div class="h-full flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-800">
        <h1 class="text-lg font-semibold text-white">System Logs</h1>
        <div class="flex items-center gap-4">
          <!-- Filter -->
          <div class="flex gap-2">
            <button
              v-for="f in ['all', 'info', 'warn', 'error'] as const"
              :key="f"
              @click="filter = f"
              :class="[
                'px-3 py-1 text-sm rounded transition-colors capitalize',
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              ]"
            >
              {{ f }}
            </button>
          </div>
          <button
            @click="clearLogs"
            class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      <!-- Log List -->
      <div class="flex-1 overflow-y-auto p-4 font-mono text-sm">
        <div v-if="filteredLogs.length === 0" class="flex items-center justify-center h-full text-gray-400">
          No logs to display
        </div>

        <div
          v-for="(log, index) in filteredLogs"
          :key="index"
          class="flex items-start gap-4 py-2 border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
        >
          <span class="text-gray-500 shrink-0">{{ formatTime(log.timestamp) }}</span>
          <span
            :class="['px-2 py-0.5 rounded text-xs font-medium shrink-0 uppercase', getLevelColor(log.level)]"
          >
            {{ log.level }}
          </span>
          <span class="text-gray-300 flex-1">{{ log.message }}</span>
          <span v-if="log.context?.traceId" class="text-gray-600 text-xs shrink-0">
            {{ log.context.traceId as string }}
          </span>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
