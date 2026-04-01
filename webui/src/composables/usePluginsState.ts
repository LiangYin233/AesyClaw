import { computed, onBeforeUnmount, onMounted, readonly, ref, watch } from 'vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import type { PluginInfo } from '@/lib/types';

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

export function usePluginsState(token: string | null) {
  const plugins = ref<PluginInfo[]>([]);
  const selectedName = ref('');
  const optionsDraft = ref('{}');
  const loading = ref(false);
  const saving = ref(false);
  const error = ref('');
  const jsonError = ref('');
  let stopPluginsSubscription: (() => void) | null = null;

  const selectedPlugin = computed(() => plugins.value.find((plugin) => plugin.name === selectedName.value) || plugins.value[0] || null);
  const enabledCount = computed(() => plugins.value.filter((plugin) => plugin.enabled).length);
  const disabledCount = computed(() => plugins.value.filter((plugin) => !plugin.enabled).length);
  const totalTools = computed(() => plugins.value.reduce((sum, plugin) => sum + plugin.toolCount, 0));

  function selectPlugin(name: string) {
    selectedName.value = name;
  }

  function syncDraft(plugin: PluginInfo | null) {
    optionsDraft.value = JSON.stringify(plugin?.settings || {}, null, 2);
    jsonError.value = '';
  }

  async function togglePlugin(plugin: PluginInfo) {
    const result = await rpcCall<{ success: true }>('plugins.toggle', token, {
      name: plugin.name,
      enabled: !plugin.enabled
    });

    if (result.error) {
      error.value = result.error;
    }
  }

  async function savePluginConfig() {
    if (!selectedPlugin.value) {
      return;
    }

    try {
      jsonError.value = '';
      const settings = parseJsonObject(optionsDraft.value, '插件配置');
      saving.value = true;
      const result = await rpcCall<{ success: true }>('plugins.updateConfig', token, {
        name: selectedPlugin.value.name,
        settings
      });
      saving.value = false;

      if (result.error) {
        error.value = result.error;
      }
    } catch (parseError) {
      jsonError.value = parseError instanceof Error ? parseError.message : 'JSON 解析失败';
    }
  }

  function bindSubscription() {
    stopPluginsSubscription?.();
    loading.value = true;
    stopPluginsSubscription = rpcSubscribe<{ plugins: PluginInfo[] }>(
      'plugins.list',
      token,
      undefined,
      (data) => {
        plugins.value = data.plugins;
        if (!data.plugins.some((plugin) => plugin.name === selectedName.value)) {
          selectedName.value = data.plugins[0]?.name || '';
        }
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

  watch(selectedPlugin, (plugin) => {
    syncDraft(plugin);
  }, { immediate: true });

  onMounted(() => {
    bindSubscription();
  });

  onBeforeUnmount(() => {
    stopPluginsSubscription?.();
    stopPluginsSubscription = null;
  });

  return {
    plugins: readonly(plugins),
    selectedName,
    selectedPlugin,
    optionsDraft,
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    jsonError: readonly(jsonError),
    enabledCount,
    disabledCount,
    totalTools,
    selectPlugin,
    togglePlugin,
    savePluginConfig
  };
}
