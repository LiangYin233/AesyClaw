<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '../components/AppLayout.vue';
import { sessionsApi, type SessionInfo } from '../lib/api';

const router = useRouter();
const sessions = ref<SessionInfo[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

async function loadSessions() {
  loading.value = true;
  error.value = null;

  try {
    const data = await sessionsApi.list();
    sessions.value = data.sessions || [];
  } catch (err: any) {
    error.value = err.message || 'Failed to load sessions';
  } finally {
    loading.value = false;
  }
}

async function deleteSession(chatId: string) {
  if (!confirm('Are you sure you want to delete this session?')) return;

  try {
    await sessionsApi.delete(chatId);
    sessions.value = sessions.value.filter((s) => s.chatId !== chatId);
  } catch (err: any) {
    alert(err.message || 'Failed to delete session');
  }
}

async function clearSession(chatId: string) {
  if (!confirm('Are you sure you want to clear this session history?')) return;

  try {
    await sessionsApi.clear(chatId);
    loadSessions();
  } catch (err: any) {
    alert(err.message || 'Failed to clear session');
  }
}

function openDialogue(chatId: string) {
  router.push(`/dialogue/${chatId}`);
}

onMounted(loadSessions);
</script>

<template>
  <AppLayout>
    <div class="h-full overflow-y-auto p-6">
      <div class="max-w-7xl mx-auto">
        <div class="flex items-center justify-between mb-6">
          <h1 class="text-2xl font-bold text-white">Sessions</h1>
          <button
            @click="loadSessions"
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

        <div v-else class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <table class="w-full">
            <thead class="bg-gray-700/50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Title</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Chat ID</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Messages</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Tokens</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Updated</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-700">
              <tr v-for="session in sessions" :key="session.chatId" class="hover:bg-gray-700/30 transition-colors">
                <td class="px-6 py-4 whitespace-nowrap">
                  <span class="text-white font-medium">{{ session.title || 'Untitled' }}</span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-gray-400 text-sm">{{ session.chatId }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-gray-300">{{ session.messageCount }}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="flex items-center gap-2">
                    <div class="w-24 bg-gray-700 rounded-full h-2">
                      <div
                        class="bg-blue-500 h-2 rounded-full"
                        :style="{
                          width: `${Math.min((session.tokenUsage?.totalTokens || 0) / (session.memoryStats?.maxTokens || 80000) * 100, 100)}%`
                        }"
                      ></div>
                    </div>
                    <span class="text-gray-400 text-sm">{{ session.tokenUsage?.totalTokens || 0 }}</span>
                  </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-gray-400 text-sm">
                  {{ new Date(session.updatedAt).toLocaleString() }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <button
                    @click="openDialogue(session.chatId)"
                    class="text-blue-400 hover:text-blue-300 mr-3"
                  >
                    Open
                  </button>
                  <button
                    @click="clearSession(session.chatId)"
                    class="text-yellow-400 hover:text-yellow-300 mr-3"
                  >
                    Clear
                  </button>
                  <button
                    @click="deleteSession(session.chatId)"
                    class="text-red-400 hover:text-red-300"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <div v-if="sessions.length === 0" class="text-center py-12 text-gray-400">
            No sessions found
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
