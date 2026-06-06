import { ref, watch } from 'vue';
import { useWebSocket } from './useWebSocket';

export const authenticated = ref<boolean | null>(null);

async function login(rawToken: string): Promise<boolean> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({ token: rawToken }),
  });

  if (!response.ok) {
    authenticated.value = false;
    return false;
  }

  authenticated.value = true;
  const ws = useWebSocket();
  ws.connect();
  return true;
}

function logout(): void {
  authenticated.value = false;
  void fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
  }).catch(() => undefined);
  const ws = useWebSocket();
  ws.disconnect();
}

async function verifyToken(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/check', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    authenticated.value = response.ok;
    return response.ok;
  } catch {
    authenticated.value = false;
    return false;
  }
}

// 惰性初始化：首次调用 useAuth() 时安装认证状态清理监听
let initialized = false;

export function useAuth() {
  if (!initialized) {
    initialized = true;
    watch(authenticated, (isAuthenticated) => {
      const ws = useWebSocket();
      if (isAuthenticated !== true) {
        ws.disconnect();
      }
    });
  }
  return { authenticated, login, logout, verifyToken };
}
