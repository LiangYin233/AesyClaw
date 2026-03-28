import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import type { WorkerRuntimeSnapshot } from '@/lib/types';

export function useAgentWorkerRuntime(token: string | null) {
  const snapshot = shallowRef<WorkerRuntimeSnapshot | null>(null);
  const loading = shallowRef(false);
  const error = shallowRef('');
  const abortingSessionKey = shallowRef('');
  let stopSubscription: (() => void) | null = null;

  async function loadWorkerRuntime() {
    loading.value = true;
    error.value = '';
    const result = await rpcCall<WorkerRuntimeSnapshot>('agents.getWorkerRuntime', token);

    if (result.error) {
      error.value = result.error;
      loading.value = false;
      return;
    }

    snapshot.value = result.data;
    loading.value = false;
  }

  async function abortSession(sessionKey: string) {
    abortingSessionKey.value = sessionKey;
    const result = await rpcCall<{ success: boolean }>('agents.abortWorkerSession', token, { sessionKey });
    abortingSessionKey.value = '';

    if (result.error) {
      error.value = result.error;
      return false;
    }

    await loadWorkerRuntime();
    return Boolean(result.data?.success);
  }

  function startSubscription() {
    stopSubscription?.();
    stopSubscription = rpcSubscribe<WorkerRuntimeSnapshot>(
      'agents.workerRuntime',
      token,
      undefined,
      (data) => {
        snapshot.value = data;
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
    void loadWorkerRuntime();
    startSubscription();
  });

  onBeforeUnmount(() => {
    stopSubscription?.();
    stopSubscription = null;
  });

  return {
    snapshot,
    loading,
    error,
    abortingSessionKey,
    loadWorkerRuntime,
    abortSession
  };
}
