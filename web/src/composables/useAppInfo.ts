import { ref } from 'vue';
import { useWebSocket } from './useWebSocket';

const appVersion = ref('');

export function useAppInfo() {
  const ws = useWebSocket();

  async function fetchVersion() {
    try {
      const data = (await ws.send('get_status')) as Record<string, unknown>;
      appVersion.value = (data['version'] as string) ?? '';
    } catch {
      // 静默失败
    }
  }

  return { appVersion, fetchVersion };
}
