<script setup lang="ts">
import { ref, onMounted } from 'vue';
import AppLayout from '../components/AppLayout.vue';
import { agentsApi } from '../lib/api';

interface AgentInfo {
  chatId: string;
  instanceId: string;
  memoryStats: {
    totalMessages: number;
    totalTokens: number;
    currentPhase: string;
  };
  tokenBudget: {
    currentTokens: number;
    maxTokens: number;
    usagePercentage: number;
  };
}

const agents = ref<AgentInfo[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

async function loadAgents() {
  loading.value = true;
  error.value = null;

  try {
    const data = await agentsApi.getStats();
    agents.value = data.agents || [];
  } catch (err: any) {
    error.value = err.message || 'Failed to load agents';
  } finally {
    loading.value = false;
  }
}

onMounted(loadAgents);
</script>

<template>
  <AppLayout>
    <div class="h-full overflow-y-auto p-6">
      <div class="max-w-7xl mx-auto">
        <div class="flex items-center justify-between mb-6">
          <h1 class="text-2xl font-bold text-white">Agents</h1>
          <button
            @click="loadAgents"
            class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Refresh
          </button>
        </div>

        <div v-if="loading" class="flex items-center justify-center h-64">
          <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>

        <div v-else-if="error" class="p-4 bg-red-900/50 border border-red-700 rounded-lg">
          <p class="text-red-300">{{ error }}</p>
        </div>

        <div v-else class="grid gap-4">
          <div
            v-for="agent in agents"
            :key="agent.chatId"
            class="bg-gray-800 rounded-lg border border-gray-700 p-6"
          >
            <div class="flex items-start justify-between">
              <div>
                <h3 class="text-lg font-semibold text-white">{{ agent.chatId }}</h3>
                <p class="text-sm text-gray-400 mt-1">Instance: {{ agent.instanceId }}</p>
              </div>
              <span
                :class="[
                  'px-2 py-1 text-xs font-medium rounded',
                  agent.memoryStats?.currentPhase === 'idle'
                    ? 'bg-green-600/20 text-green-400'
                    : 'bg-yellow-600/20 text-yellow-400'
                ]"
              >
                {{ agent.memoryStats?.currentPhase || 'idle' }}
              </span>
            </div>

            <div class="mt-4 grid grid-cols-3 gap-4">
              <div class="bg-gray-700/50 rounded-lg p-4">
                <p class="text-sm text-gray-400">Messages</p>
                <p class="text-xl font-bold text-white mt-1">
                  {{ agent.memoryStats?.totalMessages || 0 }}
                </p>
              </div>
              <div class="bg-gray-700/50 rounded-lg p-4">
                <p class="text-sm text-gray-400">Tokens</p>
                <p class="text-xl font-bold text-white mt-1">
                  {{ agent.tokenBudget?.currentTokens || 0 }}
                </p>
              </div>
              <div class="bg-gray-700/50 rounded-lg p-4">
                <p class="text-sm text-gray-400">Usage</p>
                <p class="text-xl font-bold text-white mt-1">
                  {{ agent.tokenBudget?.usagePercentage?.toFixed(1) || 0 }}%
                </p>
              </div>
            </div>
          </div>

          <div v-if="agents.length === 0" class="text-center py-12 text-gray-400">
            No active agents
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
