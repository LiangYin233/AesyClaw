import { ref } from 'vue';
import { useAuth } from './useAuth';

const appVersion = ref('');

export function useAppInfo() {
  const { api } = useAuth();

  async function fetchVersion() {
    try {
      const res = await api.get('/status');
      appVersion.value = res.data.data.version;
    } catch {
      // 静默失败
    }
  }

  return { appVersion, fetchVersion };
}
