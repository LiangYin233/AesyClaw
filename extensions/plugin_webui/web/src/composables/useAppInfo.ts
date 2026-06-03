import { ref } from 'vue';
import { useWebSocket } from './useWebSocket';

const appVersion = ref('');

/**
 * 应用信息 composable。
 * 通过 WebSocket 获取服务端版本信息。
 *
 * @returns appVersion ref 和 fetchVersion 方法
 */
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
