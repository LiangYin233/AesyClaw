import { computed, onBeforeUnmount, onMounted, readonly, ref, watch } from 'vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import type { MCPServerInfo, ToolInfo } from '@/lib/types';

type McpDraft = NonNullable<MCPServerInfo['config']>;

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

function createMcpDraft(): McpDraft {
  return {
    enabled: true,
    type: 'local',
    command: [],
    url: '',
    timeout: 30000,
    environment: {},
    headers: {}
  };
}

export function useMcpState(token: string | null) {
  const servers = ref<MCPServerInfo[]>([]);
  const tools = ref<ToolInfo[]>([]);
  const selectedName = ref('');
  const draftName = ref('');
  const draft = ref<McpDraft>(createMcpDraft());
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

  function syncDraft(server: MCPServerInfo | null) {
    draft.value = {
      ...createMcpDraft(),
      ...(server?.config || {})
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
      disconnected: '未连接'
    };
    return map[status] || status;
  }

  function statusBadgeTone(status: MCPServerInfo['status']) {
    if (status === 'connected') {
      return 'bg-emerald-100 text-emerald-700';
    }
    if (status === 'connecting') {
      return 'bg-tertiary-fixed text-tertiary';
    }
    if (status === 'failed') {
      return 'bg-error-container text-on-error-container';
    }
    return 'bg-surface-container-high text-on-surface-variant';
  }

  function statusIconTone(status: MCPServerInfo['status']) {
    if (status === 'connected') {
      return 'bg-primary-fixed text-primary';
    }
    if (status === 'connecting') {
      return 'bg-tertiary-fixed text-tertiary';
    }
    if (status === 'failed') {
      return 'bg-error-container text-on-error-container';
    }
    return 'bg-surface-container-low text-outline';
  }

  function serverAddress(server: MCPServerInfo) {
    return server.config.type === 'http'
      ? server.config.url || '(未配置 URL)'
      : (server.config.command?.join(' ') || '(未配置 command)');
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
        headers: parseStringRecord(headersText.value, 'Headers')
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

  function bindServersSubscription() {
    stopServersSubscription?.();
    loading.value = true;
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

  watch(selectedName, (name) => {
    bindDetailSubscription(name);
  }, { immediate: true });

  onMounted(() => {
    bindServersSubscription();
  });

  onBeforeUnmount(() => {
    stopServersSubscription?.();
    stopServersSubscription = null;
    stopDetailSubscription?.();
    stopDetailSubscription = null;
  });

  return {
    servers: readonly(servers),
    tools: readonly(tools),
    selectedName,
    draftName,
    draft,
    commandText,
    environmentText,
    headersText,
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    jsonError: readonly(jsonError),
    connectedCount,
    disconnectedCount,
    totalTools,
    statusLabel,
    statusBadgeTone,
    statusIconTone,
    serverAddress,
    selectServer,
    startCreate,
    saveServer,
    reconnectServer,
    deleteServer
  };
}
