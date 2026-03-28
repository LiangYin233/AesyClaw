<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1760px]">
      <div class="flex min-h-[calc(100vh-8rem)] flex-col gap-6 xl:flex-row">
        <section class="min-w-0 flex-1">
          <header class="mb-8">
            <p class="cn-kicker text-outline">MCP</p>
            <h1 class="cn-page-title mt-2 text-on-surface">MCP 连接中心</h1>
          </header>

          <div v-if="error" class="mb-6 rounded-2xl border border-error/20 bg-error-container/60 px-5 py-4 text-sm text-on-error-container">
            <p class="font-bold">MCP 数据加载失败</p>
            <p class="mt-2 leading-6">{{ error }}</p>
          </div>

          <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article class="hairline-card rounded-2xl p-5">
              <p class="cn-kicker text-outline">服务总数</p>
              <div class="mt-2 flex items-end gap-2">
                <span class="cn-metric text-primary">{{ servers.length }}</span>
              </div>
            </article>
            <article class="hairline-card rounded-2xl p-5">
              <p class="cn-kicker text-outline">已连接</p>
              <div class="mt-2 flex items-end gap-2">
                <span class="cn-metric text-emerald-600">{{ connectedCount }}</span>
                <span class="inline-block size-2 rounded-full bg-emerald-500"></span>
              </div>
            </article>
            <article class="hairline-card rounded-2xl p-5">
              <p class="cn-kicker text-outline">未连接</p>
              <div class="mt-2 flex items-end gap-2">
                <span class="cn-metric text-error">{{ disconnectedCount }}</span>
              </div>
            </article>
            <article class="hairline-card rounded-2xl p-5">
              <p class="cn-kicker text-outline">暴露工具</p>
              <div class="mt-2 flex items-end gap-2">
                <span class="cn-metric text-on-surface">{{ totalTools }}</span>
              </div>
            </article>
          </div>

          <div class="mb-4 flex items-center justify-between px-2">
            <h2 class="cn-section-title text-on-surface">已注册节点</h2>
            <div class="flex gap-3">
              <button class="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white transition hover:opacity-90" type="button" @click="startCreate">
                连接新服务
              </button>
            </div>
          </div>

          <div class="space-y-4">
            <article
              v-for="server in servers"
              :key="server.name"
              class="rounded-[1.6rem] border border-outline-variant/10 bg-surface-container-lowest p-4 transition-all hover:shadow-[0_12px_40px_rgba(0,74,198,0.06)]"
              :class="selectedName === server.name ? 'ring-2 ring-primary/15' : ''"
            >
              <div class="flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
                <button class="flex min-w-0 flex-1 items-center gap-5 text-left" type="button" @click="selectServer(server.name)">
                  <div class="flex size-12 shrink-0 items-center justify-center rounded-2xl" :class="statusIconTone(server.status)">
                    <AppIcon name="mcp" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="mb-1 flex flex-wrap items-center gap-3">
                      <h3 class="truncate text-base font-bold text-on-surface">{{ server.name }}</h3>
                      <span class="rounded px-2 py-0.5 text-[10px] font-bold tracking-[0.08em]" :class="statusBadgeTone(server.status)">{{ statusLabel(server.status) }}</span>
                    </div>
                    <p class="tech-text text-xs text-on-surface-variant">{{ serverAddress(server) }}</p>
                  </div>
                </button>

                <div class="flex items-center gap-8 border-slate-100 md:border-x md:px-6">
                  <div class="text-center">
                    <p class="text-[10px] font-bold tracking-[0.08em] text-outline">工具</p>
                    <p class="text-sm font-black text-on-surface">{{ server.toolCount }}</p>
                  </div>
                  <div class="text-center">
                    <p class="text-[10px] font-bold tracking-[0.08em] text-outline">最后连接</p>
                    <p class="tech-text text-xs text-on-surface">{{ server.connectedAt ? formatRelativeTime(server.connectedAt) : '--' }}</p>
                  </div>
                </div>

                <div class="flex flex-col items-start gap-2 md:items-end">
                  <p class="tech-text text-[11px]" :class="server.error ? 'text-error' : 'text-outline'">{{ server.error || `已连接：${server.connectedAt ? formatDateTime(server.connectedAt) : '-'}` }}</p>
                  <div class="flex gap-2">
                    <button class="rounded-lg border border-outline-variant/20 px-3 py-2 text-xs font-semibold text-on-surface transition hover:bg-surface-container-high" type="button" @click="selectServer(server.name)">
                      检视
                    </button>
                    <button v-if="server.status !== 'connected'" class="rounded-lg bg-primary-fixed px-3 py-2 text-xs font-bold text-on-primary-fixed transition hover:opacity-90" type="button" @click="reconnectServer(server.name)">
                      重连
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>

        <aside class="w-full shrink-0 xl:w-[420px]">
          <div class="sidebar-rail-scroll space-y-6">
            <section class="rounded-[1.6rem] bg-surface-container-low p-6">
              <div class="mb-5 flex items-center justify-between">
                <h3 class="cn-section-title text-on-surface">{{ selectedName ? '服务配置' : '新建服务' }}</h3>
                <button v-if="selectedName" class="text-[11px] font-bold tracking-[0.08em] text-primary" type="button" @click="startCreate">新增</button>
              </div>

              <div class="space-y-4">
                <label>
                  <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">服务名</span>
                  <input v-model="draftName" class="tech-text w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3 text-sm text-on-surface outline-none" type="text" placeholder="knowledge_base" />
                </label>
                <div class="grid grid-cols-2 gap-3">
                  <label>
                    <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">传输类型</span>
                    <select v-model="draft.type" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3 text-sm text-on-surface outline-none">
                      <option value="local">local</option>
                      <option value="http">http</option>
                    </select>
                  </label>
                  <label class="flex items-center justify-between rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
                    <div>
                      <p class="text-sm font-semibold text-on-surface">启用</p>
                      <p class="mt-1 text-[11px] text-on-surface-variant">保存后即时切换</p>
                    </div>
                    <button class="relative h-5 w-10 rounded-full transition" :class="draft.enabled ? 'bg-primary-container' : 'bg-surface-container-high'" type="button" @click="draft.enabled = !draft.enabled">
                      <span class="absolute top-0.5 size-4 rounded-full bg-white transition" :class="draft.enabled ? 'right-0.5' : 'left-0.5'"></span>
                    </button>
                  </label>
                </div>

                <label v-if="draft.type === 'http'">
                  <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">URL</span>
                  <input v-model="draft.url" class="tech-text w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3 text-sm text-on-surface outline-none" type="text" placeholder="https://example.com/mcp" />
                </label>

                <label v-else>
                  <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">Command</span>
                  <textarea v-model="commandText" class="tech-text min-h-24 w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3 text-xs text-on-surface outline-none" spellcheck="false" placeholder="npx&#10;@modelcontextprotocol/server-filesystem&#10;/workspace"></textarea>
                </label>

                <label>
                  <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">超时 (ms)</span>
                  <input v-model.number="draft.timeout" class="tech-text w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3 text-sm text-on-surface outline-none" type="number" min="1000" />
                </label>

                <label>
                  <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">Environment JSON</span>
                  <textarea v-model="environmentText" class="tech-text min-h-24 w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3 text-xs text-on-surface outline-none" spellcheck="false"></textarea>
                </label>

                <label>
                  <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">Headers JSON</span>
                  <textarea v-model="headersText" class="tech-text min-h-24 w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3 text-xs text-on-surface outline-none" spellcheck="false"></textarea>
                </label>

                <p v-if="jsonError" class="text-xs text-error">{{ jsonError }}</p>

                <div class="grid grid-cols-2 gap-3">
                  <button class="rounded-xl bg-surface-container-high py-3 text-sm font-bold text-on-surface transition hover:bg-surface-container-highest" type="button" :disabled="saving" @click="saveServer">
                    {{ saving ? '保存中...' : '保存配置' }}
                  </button>
                  <button v-if="selectedName" class="rounded-xl border border-error/20 py-3 text-sm font-bold text-error transition hover:bg-error-container/60" type="button" :disabled="saving" @click="deleteServer">
                    删除服务
                  </button>
                </div>
              </div>
            </section>

            <section class="hairline-card rounded-[1.6rem] p-5">
              <div class="mb-4 flex items-center justify-between">
                <h3 class="cn-section-title text-on-surface">暴露工具</h3>
                <span class="tech-text text-[11px] text-outline">{{ tools.length }}</span>
              </div>
              <div class="max-h-[22rem] space-y-3 overflow-y-auto pr-2">
                <div v-for="tool in tools" :key="tool.name" class="rounded-xl bg-surface-container-low px-3 py-3">
                  <div class="flex items-start justify-between gap-3">
                    <h4 class="tech-text break-anywhere text-xs font-bold text-on-surface">{{ tool.name }}</h4>
                    <span class="rounded bg-primary-fixed px-1.5 py-0.5 text-[10px] font-bold text-on-primary-fixed">{{ Object.keys(tool.parameters || {}).length }} 参</span>
                  </div>
                  <p class="mt-2 text-[11px] leading-5 text-on-surface-variant">{{ tool.description || '暂无工具描述。' }}</p>
                </div>
                <p v-if="!tools.length" class="text-sm text-on-surface-variant">当前服务尚未暴露工具，或仍未连接成功。</p>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppIcon from '@/components/AppIcon.vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import { getRouteToken } from '@/lib/auth';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import type { MCPServerInfo, ToolInfo } from '@/lib/types';
import { useRoute } from 'vue-router';

type McpDraft = NonNullable<MCPServerInfo['config']>;

const route = useRoute();
const token = getRouteToken(route);

const servers = ref<MCPServerInfo[]>([]);
const tools = ref<ToolInfo[]>([]);
const selectedName = ref('');
const draftName = ref('');
const draft = ref<McpDraft>(createDraft());
const commandText = ref('');
const environmentText = ref('{}');
const headersText = ref('{}');
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const jsonError = ref('');
const isCreating = ref(false);
let stopServersSubscription: (() => void) | null = null;
let stopDetailSubscription: (() => void) | null = null;

const connectedCount = computed(() => servers.value.filter((server) => server.status === 'connected').length);
const disconnectedCount = computed(() => servers.value.filter((server) => server.status !== 'connected').length);
const totalTools = computed(() => servers.value.reduce((sum, server) => sum + server.toolCount, 0));

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} 必须是有效的 JSON 格式`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} 必须是 JSON 对象`);
  }

  return parsed as Record<string, unknown>;
}

function parseStringRecord(text: string, label: string): Record<string, string> {
  const parsed = parseJsonObject(text, label);
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`${label} 中的 "${key}" 必须是字符串`);
    }
  }
  return parsed as Record<string, string>;
}

function createDraft(): McpDraft {
  return {
    enabled: true,
    type: 'local',
    command: [],
    url: '',
    timeout: 30000,
    environment: {},
    headers: {},
  };
}

function syncDraft(server: MCPServerInfo | null) {
  draft.value = {
    ...createDraft(),
    ...(server?.config || {}),
  };
  draftName.value = server?.name || '';
  commandText.value = (server?.config.command || []).join('\n');
  environmentText.value = JSON.stringify(server?.config.environment || {}, null, 2);
  headersText.value = JSON.stringify(server?.config.headers || {}, null, 2);
  jsonError.value = '';
}

function statusLabel(status: MCPServerInfo['status']) {
  const map = {
    connected: '已连接',
    connecting: '连接中',
    failed: '失败',
    disconnected: '未连接',
  };
  return map[status] || status;
}

function statusBadgeTone(status: MCPServerInfo['status']) {
  if (status === 'connected') return 'bg-emerald-100 text-emerald-700';
  if (status === 'connecting') return 'bg-tertiary-fixed text-tertiary';
  if (status === 'failed') return 'bg-error-container text-on-error-container';
  return 'bg-surface-container-high text-on-surface-variant';
}

function statusIconTone(status: MCPServerInfo['status']) {
  if (status === 'connected') return 'bg-primary-fixed text-primary';
  if (status === 'connecting') return 'bg-tertiary-fixed text-tertiary';
  if (status === 'failed') return 'bg-error-container text-on-error-container';
  return 'bg-surface-container-low text-outline';
}

function serverAddress(server: MCPServerInfo) {
  return server.config.type === 'http'
    ? server.config.url || '(未配置 URL)'
    : (server.config.command?.join(' ') || '(未配置 command)');
}

async function loadServers() {
  loading.value = true;
  error.value = '';

  const result = await rpcCall<{ servers: MCPServerInfo[] }>('mcp.list', token);
  loading.value = false;

  if (result.error || !result.data) {
    error.value = result.error || 'MCP 服务加载失败';
    servers.value = [];
    return;
  }

  syncServers(result.data.servers);
}

function syncServers(nextServers: MCPServerInfo[]) {
  servers.value = nextServers;

  if (selectedName.value) {
    if (nextServers.some((server) => server.name === selectedName.value)) {
      return;
    }
    selectedName.value = '';
  }

  if (!nextServers.length) {
    tools.value = [];
    syncDraft(null);
    return;
  }

  if (!isCreating.value) {
    selectedName.value = nextServers[0].name;
  }
}

function selectServer(name: string) {
  selectedName.value = name;
  isCreating.value = false;
}

function startCreate() {
  isCreating.value = true;
  selectedName.value = '';
  tools.value = [];
  syncDraft(null);
}

async function saveServer() {
  if (!draftName.value.trim()) {
    error.value = '请填写服务名称';
    return;
  }

  try {
    jsonError.value = '';
    const payload: McpDraft = {
      ...draft.value,
      command: draft.value.type === 'local'
        ? commandText.value.split('\n').map((line) => line.trim()).filter(Boolean)
        : undefined,
      url: draft.value.type === 'http' ? draft.value.url?.trim() : undefined,
      environment: parseStringRecord(environmentText.value, 'Environment'),
      headers: parseStringRecord(headersText.value, 'Headers'),
    };

    saving.value = true;
    const result = await rpcCall<{ success: true }>('mcp.create', token, {
      name: draftName.value.trim(),
      config: payload
    });
    saving.value = false;

    if (result.error) {
      error.value = result.error;
      return;
    }

    isCreating.value = false;
    selectedName.value = draftName.value.trim();
  } catch (parseError) {
    jsonError.value = parseError instanceof Error ? parseError.message : 'JSON 解析失败';
  }
}

async function reconnectServer(name: string) {
  const result = await rpcCall<{ success: true }>('mcp.reconnect', token, { name });
  if (result.error) {
    error.value = result.error;
    return;
  }
}

async function deleteServer() {
  if (!selectedName.value || !window.confirm(`确认删除 MCP 服务 ${selectedName.value} 吗？`)) {
    return;
  }

  saving.value = true;
  const result = await rpcCall<{ success: true }>('mcp.delete', token, { name: selectedName.value });
  saving.value = false;

  if (result.error) {
    error.value = result.error;
    return;
  }

  isCreating.value = false;
  startCreate();
}

watch(selectedName, (name) => {
  if (!name) {
    syncDraft(null);
    tools.value = [];
    return;
  }

  const selected = servers.value.find((server) => server.name === name) || null;
  if (selected) {
    syncDraft(selected);
  }
});

function bindServersSubscription() {
  stopServersSubscription?.();
  stopServersSubscription = rpcSubscribe<{ servers: MCPServerInfo[] }>(
    'mcp.list',
    token,
    undefined,
    (data) => {
      syncServers(data.servers);
      loading.value = false;
      error.value = '';
    },
    {
      onError: (message) => {
        error.value = message;
        loading.value = false;
      }
    }
  );
}

function bindDetailSubscription(name: string) {
  stopDetailSubscription?.();
  stopDetailSubscription = null;

  if (!name) {
    return;
  }

  stopDetailSubscription = rpcSubscribe<{ server: MCPServerInfo; tools: ToolInfo[] } | null>(
    'mcp.detail',
    token,
    { name },
    (data) => {
      if (!data?.server) {
        if (selectedName.value === name) {
          startCreate();
        }
        return;
      }

      tools.value = data.tools || [];
      syncDraft(data.server);
      error.value = '';
    },
    {
      onError: (message) => {
        error.value = message;
      }
    }
  );
}

watch(selectedName, (name) => {
  bindDetailSubscription(name);
}, { immediate: true });

onMounted(() => {
  void loadServers();
  bindServersSubscription();
});

onBeforeUnmount(() => {
  stopServersSubscription?.();
  stopServersSubscription = null;
  stopDetailSubscription?.();
  stopDetailSubscription = null;
});
</script>
