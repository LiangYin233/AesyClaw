import { ref, watch } from 'vue';
import { useWebSocket } from './useWebSocket';

export const authenticated = ref<boolean | null>(null);

/** 内存缓存：避免每次路由导航都发起 HTTP 请求 */
let verifyPromise: Promise<boolean> | null = null;

/**
 * 确保会话有效。
 * - 已认证且缓存未失效 → 直接返回 true，不发 HTTP
 * - 正在验证中 → 等待正在进行的请求
 * - 首次 / 已登出 → 发起 /api/auth/check，成功后缓存结果
 */
async function ensureSession(): Promise<boolean> {
  if (authenticated.value === true && verifyPromise !== null) {
    return true;
  }
  if (verifyPromise !== null) {
    return await verifyPromise;
  }
  verifyPromise = verifyToken();
  const result = await verifyPromise;
  if (!result) {
    // 验证失败不缓存，允许下次重试
    verifyPromise = null;
  }
  return result;
}

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
  verifyPromise = Promise.resolve(true);
  const ws = useWebSocket();
  ws.connect();
  return true;
}

function logout(): void {
  authenticated.value = false;
  verifyPromise = null;
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
  return { authenticated, login, logout, ensureSession };
}
