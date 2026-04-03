<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import AppLayout from '../components/AppLayout.vue';
import { sessionsApi, type SessionInfo } from '../lib/api';

const sessions = ref<SessionInfo[]>([]);
const selectedSession = ref<SessionInfo | null>(null);
const memoryDetails = ref<{
  stats: { totalMessages: number; totalTokens: number; currentPhase: string };
  budget: { currentTokens: number; maxTokens: number; usagePercentage: number };
  messages: Array<{ role: string; content: string }>;
} | null>(null);
const loading = ref(true);
const detailsLoading = ref(false);

async function loadSessions() {
  loading.value = true;
  try {
    const data = await sessionsApi.list();
    sessions.value = data.sessions || [];
  } catch (err) {
    console.error(err);
  } finally {
    loading.value = false;
  }
}

async function selectSession(session: SessionInfo) {
  selectedSession.value = session;
  detailsLoading.value = true;
  memoryDetails.value = null;

  try {
    const data = await sessionsApi.getMemory(session.chatId);
    memoryDetails.value = data;
  } catch (err) {
    console.error(err);
  } finally {
    detailsLoading.value = false;
  }
}

const tokenUsagePercentage = computed(() => {
  if (!memoryDetails.value?.budget) return 0;
  return Math.min((memoryDetails.value.budget.currentTokens / memoryDetails.value.budget.maxTokens) * 100, 100);
});

const usageColor = computed(() => {
  const pct = tokenUsagePercentage.value;
  if (pct < 50) return 'bg-green-500';
  if (pct < 80) return 'bg-yellow-500';
  return 'bg-red-500';
});

onMounted(loadSessions);
</script>

<template>
  <AppLayout>
    <div class="h-full overflow-hidden flex">
      <!-- Session List -->
      <div class="w-80 border-r border-gray-700 bg-gray-800 flex flex-col">
        <div class="p-4 border-b border-gray-700">
          <h2 class="text-lg font-semibold text-white">Sessions</h2>
        </div>
        <div class="flex-1 overflow-y-auto">
          <div v-if="loading" class="p-4 text-center text-gray-400">
            Loading...
          </div>
          <div
            v-else
            v-for="session in sessions"
            :key="session.chatId"
            @click="selectSession(session)"
            :class="[
              'p-4 border-b border-gray-700 cursor-pointer transition-colors',
              selectedSession?.chatId === session.chatId
                ? 'bg-blue-600/20 border-l-2 border-l-blue-500'
                : 'hover:bg-gray-700/50'
            ]"
          >
            <p class="text-white font-medium truncate">{{ session.title || 'Untitled' }}</p>
            <div class="mt-2">
              <div class="flex items-center justify-between text-xs text-gray-400 mb-1">
                <span>Token Usage</span>
                <span>{{ session.tokenUsage?.totalTokens || 0 }} / {{ session.memoryStats?.maxTokens || 80000 }}</span>
              </div>
              <div class="w-full bg-gray-700 rounded-full h-1.5">
                <div
                  class="h-1.5 rounded-full transition-all"
                  :class="usageColor"
                  :style="{ width: `${Math.min((session.tokenUsage?.totalTokens || 0) / (session.memoryStats?.maxTokens || 80000) * 100, 100)}%` }"
                ></div>
              </div>
            </div>
          </div>
          <div v-if="!loading && sessions.length === 0" class="p-4 text-center text-gray-400">
            No sessions found
          </div>
        </div>
      </div>

      <!-- Memory Details -->
      <div class="flex-1 overflow-y-auto p-6">
        <div v-if="!selectedSession" class="flex items-center justify-center h-full text-gray-400">
          <div class="text-center">
            <svg class="w-16 h-16 mx-auto text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
            <p class="mt-4">Select a session to view memory details</p>
          </div>
        </div>

        <div v-else>
          <div class="flex items-center justify-between mb-6">
            <div>
              <h1 class="text-2xl font-bold text-white">Session Memory</h1>
              <p class="text-gray-400 mt-1">{{ selectedSession.title || selectedSession.chatId }}</p>
            </div>
          </div>

          <!-- Token Budget Dashboard -->
          <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
            <h2 class="text-lg font-semibold text-white mb-4">Token Budget</h2>

            <div class="flex items-center justify-between mb-4">
              <div>
                <p class="text-4xl font-bold text-white">
                  {{ memoryDetails?.budget?.currentTokens || 0 }}
                  <span class="text-xl text-gray-400">/ {{ memoryDetails?.budget?.maxTokens || 0 }}</span>
                </p>
                <p class="text-gray-400 mt-1">
                  {{ memoryDetails?.budget?.usagePercentage?.toFixed(1) || 0 }}% used
                </p>
              </div>
              <div
                :class="[
                  'px-4 py-2 rounded-lg text-sm font-medium',
                  (memoryDetails?.budget?.needsCompression)
                    ? 'bg-yellow-600/20 text-yellow-400'
                    : 'bg-green-600/20 text-green-400'
                ]"
              >
                {{ memoryDetails?.budget?.needsCompression ? 'Needs Compression' : 'Healthy' }}
              </div>
            </div>

            <!-- Progress Bar -->
            <div class="w-full bg-gray-700 rounded-full h-6 overflow-hidden">
              <div
                class="h-full transition-all duration-500"
                :class="usageColor"
                :style="{ width: `${tokenUsagePercentage}%` }"
              ></div>
            </div>

            <!-- Warning Thresholds -->
            <div class="flex justify-between text-xs text-gray-500 mt-2">
              <span>0</span>
              <span>{{ Math.floor((memoryDetails?.budget?.maxTokens || 80000) * 0.3) }} (30%)</span>
              <span>{{ Math.floor((memoryDetails?.budget?.maxTokens || 80000) * 0.625) }} (62.5%)</span>
              <span>{{ memoryDetails?.budget?.maxTokens || 80000 }}</span>
            </div>

            <!-- Memory Stats -->
            <div class="grid grid-cols-4 gap-4 mt-6">
              <div class="bg-gray-700/50 rounded-lg p-4">
                <p class="text-sm text-gray-400">Messages</p>
                <p class="text-xl font-bold text-white mt-1">{{ memoryDetails?.stats?.totalMessages || 0 }}</p>
              </div>
              <div class="bg-gray-700/50 rounded-lg p-4">
                <p class="text-sm text-gray-400">Total Tokens</p>
                <p class="text-xl font-bold text-white mt-1">{{ memoryDetails?.stats?.totalTokens || 0 }}</p>
              </div>
              <div class="bg-gray-700/50 rounded-lg p-4">
                <p class="text-sm text-gray-400">Phase</p>
                <p class="text-xl font-bold text-white mt-1 capitalize">
                  {{ memoryDetails?.stats?.currentPhase?.replace('_', ' ') || 'idle' }}
                </p>
              </div>
              <div class="bg-gray-700/50 rounded-lg p-4">
                <p class="text-sm text-gray-400">Session</p>
                <p class="text-xl font-bold text-white mt-1">{{ selectedSession.chatId.substring(0, 8) }}</p>
              </div>
            </div>
          </div>

          <!-- Lossless Summary History -->
          <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <h2 class="text-lg font-semibold text-white mb-4">Message History</h2>

            <div v-if="detailsLoading" class="flex items-center justify-center py-8">
              <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
            </div>

            <div v-else class="space-y-3 max-h-96 overflow-y-auto">
              <div
                v-for="(msg, index) in memoryDetails?.messages"
                :key="index"
                :class="[
                  'p-3 rounded-lg',
                  msg.role === 'system' ? 'bg-purple-900/30 border border-purple-800' :
                  msg.role === 'user' ? 'bg-blue-900/30 border border-blue-800' :
                  msg.role === 'tool' ? 'bg-yellow-900/30 border border-yellow-800' :
                  'bg-gray-700/50 border border-gray-600'
                ]"
              >
                <div class="flex items-center gap-2 mb-1">
                  <span
                    :class="[
                      'px-2 py-0.5 text-xs font-medium rounded',
                      msg.role === 'system' ? 'bg-purple-600/50 text-purple-300' :
                      msg.role === 'user' ? 'bg-blue-600/50 text-blue-300' :
                      msg.role === 'tool' ? 'bg-yellow-600/50 text-yellow-300' :
                      'bg-green-600/50 text-green-300'
                    ]"
                  >
                    {{ msg.role }}
                  </span>
                </div>
                <p class="text-sm text-gray-300 whitespace-pre-wrap line-clamp-3">
                  {{ msg.content }}
                </p>
              </div>

              <div v-if="!memoryDetails?.messages?.length" class="text-center py-8 text-gray-400">
                No messages in this session
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
