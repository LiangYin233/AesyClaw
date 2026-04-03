<script setup lang="ts">
import { ref, onMounted } from 'vue';
import AppLayout from '../components/AppLayout.vue';
import { configApi } from '../lib/api';

const config = ref<any>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);
const success = ref(false);

async function loadConfig() {
  loading.value = true;
  error.value = null;
  try {
    const data = await configApi.get();
    config.value = data.config;
  } catch (err: any) {
    error.value = err.message || 'Failed to load config';
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  success.value = false;
  error.value = null;
  try {
    await configApi.update(config.value);
    success.value = true;
    setTimeout(() => { success.value = false; }, 3000);
  } catch (err: any) {
    error.value = err.message || 'Failed to save config';
  } finally {
    saving.value = false;
  }
}

onMounted(loadConfig);
</script>

<template>
  <AppLayout>
    <div class="h-full overflow-y-auto p-6">
      <div class="max-w-4xl mx-auto">
        <div class="flex items-center justify-between mb-6">
          <h1 class="text-2xl font-bold text-white">Configuration</h1>
          <button
            @click="saveConfig"
            :disabled="saving"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
          >
            {{ saving ? 'Saving...' : 'Save Changes' }}
          </button>
        </div>

        <div v-if="success" class="mb-4 p-4 bg-green-900/50 border border-green-700 rounded-lg">
          <p class="text-green-300">Configuration saved successfully!</p>
        </div>

        <div v-if="error" class="mb-4 p-4 bg-red-900/50 border border-red-700 rounded-lg">
          <p class="text-red-300">{{ error }}</p>
        </div>

        <div v-if="loading" class="flex items-center justify-center h-64">
          <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>

        <div v-else-if="config" class="space-y-6">
          <!-- Server Config -->
          <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <h2 class="text-lg font-semibold text-white mb-4">Server</h2>
            <div class="grid gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2">Port</label>
                <input
                  v-model.number="config.server.port"
                  type="number"
                  class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2">Host</label>
                <input
                  v-model="config.server.host"
                  type="text"
                  class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2">Admin Token</label>
                <input
                  v-model="config.server.adminToken"
                  type="password"
                  class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          <!-- Agent Config -->
          <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <h2 class="text-lg font-semibold text-white mb-4">Agent</h2>
            <div class="grid gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2">Default Model</label>
                <input
                  v-model="config.agent.default_model"
                  type="text"
                  class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2">System Prompt</label>
                <textarea
                  v-model="config.agent.system_prompt"
                  rows="4"
                  class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                ></textarea>
              </div>
            </div>
          </div>

          <!-- Memory Config -->
          <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <h2 class="text-lg font-semibold text-white mb-4">Memory</h2>
            <div class="grid gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2">Max Context Tokens</label>
                <input
                  v-model.number="config.memory.max_context_tokens"
                  type="number"
                  class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2">Compression Threshold</label>
                <input
                  v-model.number="config.memory.compression_threshold"
                  type="number"
                  class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
