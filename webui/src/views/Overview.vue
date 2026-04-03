<script setup lang="ts">
import { ref, onMounted } from 'vue';
import AppLayout from '../components/AppLayout.vue';
import { agentsApi, sessionsApi, cronApi } from '../lib/api';

const agents = ref<{ chatId: string; memoryStats: { totalMessages: number }; tokenBudget: { currentTokens: number; maxTokens: number } }[]>([]);
const sessions = ref<{ chatId: string; title: string }[]>([]);
const cronJobs = ref<{ id: string; enabled: boolean }[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

async function loadData() {
  loading.value = true;
  error.value = null;

  try {
    const [agentsRes, sessionsRes, cronRes] = await Promise.all([
      agentsApi.getStats(),
      sessionsApi.list(),
      cronApi.list(),
    ]);

    agents.value = agentsRes.agents || [];
    sessions.value = sessionsRes.sessions || [];
    cronJobs.value = cronRes.jobs || [];
  } catch (err: any) {
    error.value = err.message || 'Failed to load data';
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);
</script>

<template>
  <AppLayout>
    <div class="h-full overflow-y-auto p-6">
      <div class="max-w-7xl mx-auto">
        <h1 class="text-2xl font-bold text-white mb-6">System Overview</h1>

        <div v-if="loading" class="flex items-center justify-center h-64">
          <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>

        <div v-else-if="error" class="p-4 bg-red-900/50 border border-red-700 rounded-lg">
          <p class="text-red-300">{{ error }}</p>
          <button @click="loadData" class="mt-2 text-sm text-red-400 hover:text-red-300">
            Retry
          </button>
        </div>

        <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <!-- Active Agents -->
          <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-400">Active Agents</p>
                <p class="text-3xl font-bold text-white mt-1">{{ agents.length }}</p>
              </div>
              <div class="p-3 bg-blue-600/20 rounded-lg">
                <svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
          </div>

          <!-- Total Sessions -->
          <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-400">Total Sessions</p>
                <p class="text-3xl font-bold text-white mt-1">{{ sessions.length }}</p>
              </div>
              <div class="p-3 bg-green-600/20 rounded-lg">
                <svg class="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
            </div>
          </div>

          <!-- Cron Jobs -->
          <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-400">Cron Jobs</p>
                <p class="text-3xl font-bold text-white mt-1">{{ cronJobs.length }}</p>
              </div>
              <div class="p-3 bg-purple-600/20 rounded-lg">
                <svg class="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>

          <!-- Total Messages -->
          <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-400">Total Messages</p>
                <p class="text-3xl font-bold text-white mt-1">
                  {{ agents.reduce((sum, a) => sum + (a.memoryStats?.totalMessages || 0), 0) }}
                </p>
              </div>
              <div class="p-3 bg-yellow-600/20 rounded-lg">
                <svg class="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <!-- Recent Activity -->
        <div class="mt-8 bg-gray-800 rounded-lg border border-gray-700">
          <div class="px-6 py-4 border-b border-gray-700">
            <h2 class="text-lg font-semibold text-white">Recent Sessions</h2>
          </div>
          <div class="divide-y divide-gray-700">
            <div
              v-for="session in sessions.slice(0, 5)"
              :key="session.chatId"
              class="px-6 py-4 flex items-center justify-between hover:bg-gray-700/50 transition-colors"
            >
              <div>
                <p class="text-white font-medium">{{ session.title || 'Untitled Session' }}</p>
                <p class="text-sm text-gray-400">{{ session.chatId }}</p>
              </div>
              <router-link
                :to="`/dialogue/${session.chatId}`"
                class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
              >
                Open
              </router-link>
            </div>
            <div v-if="sessions.length === 0" class="px-6 py-8 text-center text-gray-400">
              No sessions yet
            </div>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
