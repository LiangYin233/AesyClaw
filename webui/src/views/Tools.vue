<script setup lang="ts">
import { ref, onMounted } from 'vue';
import AppLayout from '../components/AppLayout.vue';
import { registryApi, type ToolInfo, type MCPStatus } from '../lib/api';

const tools = ref<ToolInfo[]>([]);
const mcpServers = ref<MCPStatus[]>([]);
const loading = ref(true);
const activeTab = ref<'tools' | 'mcp'>('tools');

async function loadData() {
  loading.value = true;
  try {
    const [toolsRes, mcpRes] = await Promise.all([
      registryApi.listTools(),
      registryApi.getMCPStatus(),
    ]);
    tools.value = toolsRes.tools || [];
    mcpServers.value = mcpRes.servers || [];
  } catch (err) {
    console.error(err);
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
        <h1 class="text-2xl font-bold text-white mb-6">Tools & Extensions</h1>

        <!-- Tabs -->
        <div class="flex gap-4 mb-6">
          <button
            @click="activeTab = 'tools'"
            :class="[
              'px-4 py-2 rounded-lg transition-colors',
              activeTab === 'tools'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            ]"
          >
            Tools ({{ tools.length }})
          </button>
          <button
            @click="activeTab = 'mcp'"
            :class="[
              'px-4 py-2 rounded-lg transition-colors',
              activeTab === 'mcp'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            ]"
          >
            MCP Servers ({{ mcpServers.length }})
          </button>
        </div>

        <div v-if="loading" class="flex items-center justify-center h-64">
          <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>

        <!-- Tools Tab -->
        <div v-else-if="activeTab === 'tools'" class="grid gap-4">
          <div
            v-for="tool in tools"
            :key="tool.name"
            class="bg-gray-800 rounded-lg border border-gray-700 p-6"
          >
            <div class="flex items-start justify-between">
              <div>
                <h3 class="text-lg font-semibold text-white">{{ tool.name }}</h3>
                <p class="text-gray-400 mt-1">{{ tool.description }}</p>
              </div>
            </div>

            <div v-if="tool.parameters?.properties" class="mt-4">
              <h4 class="text-sm font-medium text-gray-400 mb-2">Parameters</h4>
              <div class="bg-gray-900/50 rounded-lg p-4">
                <div
                  v-for="(schema, paramName) in tool.parameters.properties"
                  :key="paramName"
                  class="flex items-start gap-4 py-2 border-b border-gray-700 last:border-0"
                >
                  <code class="text-blue-400">{{ paramName }}</code>
                  <span class="text-gray-500">{{ (schema as any).description || 'No description' }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="tools.length === 0" class="text-center py-12 text-gray-400">
            No tools registered
          </div>
        </div>

        <!-- MCP Tab -->
        <div v-else class="grid gap-4">
          <div
            v-for="server in mcpServers"
            :key="server.server"
            class="bg-gray-800 rounded-lg border border-gray-700 p-6"
          >
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold text-white">{{ server.server }}</h3>
              <span
                :class="[
                  'px-3 py-1 text-sm font-medium rounded',
                  server.status === 'connected' ? 'bg-green-600/20 text-green-400' :
                  server.status === 'error' ? 'bg-red-600/20 text-red-400' :
                  'bg-gray-600/20 text-gray-400'
                ]"
              >
                {{ server.status }}
              </span>
            </div>
            <p v-if="server.error" class="text-red-400 mt-2">{{ server.error }}</p>
            <p v-if="server.lastChecked" class="text-gray-500 mt-2 text-sm">
              Last checked: {{ new Date(server.lastChecked).toLocaleString() }}
            </p>
          </div>

          <div v-if="mcpServers.length === 0" class="text-center py-12 text-gray-400">
            No MCP servers configured
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
