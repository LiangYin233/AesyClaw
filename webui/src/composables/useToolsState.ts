import { computed, onBeforeUnmount, onMounted, readonly, ref } from 'vue';
import { rpcSubscribe } from '@/lib/rpc';
import type { ToolInfo } from '@/lib/types';

export function useToolsState(token: string | null) {
  const tools = ref<ToolInfo[]>([]);
  const selectedName = ref('');
  const loading = ref(false);
  const error = ref('');
  let stopToolsSubscription: (() => void) | null = null;

  const selectedTool = computed(() => tools.value.find((tool) => tool.name === selectedName.value) || tools.value[0] || null);
  const formattedParameters = computed(() => JSON.stringify(selectedTool.value?.parameters || {}, null, 2));

  function selectTool(name: string) {
    selectedName.value = name;
  }

  function bindSubscription() {
    stopToolsSubscription?.();
    loading.value = true;
    stopToolsSubscription = rpcSubscribe<{ tools: ToolInfo[] }>(
      'system.tools',
      token,
      undefined,
      (data) => {
        tools.value = data.tools;
        if (!data.tools.some((tool) => tool.name === selectedName.value)) {
          selectedName.value = data.tools[0]?.name || '';
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

  onMounted(() => {
    bindSubscription();
  });

  onBeforeUnmount(() => {
    stopToolsSubscription?.();
    stopToolsSubscription = null;
  });

  return {
    tools: readonly(tools),
    selectedName,
    selectedTool,
    formattedParameters,
    loading: readonly(loading),
    error: readonly(error),
    selectTool
  };
}
