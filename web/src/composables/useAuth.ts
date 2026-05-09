import { ref, watch } from 'vue';
import { useWebSocket } from './useWebSocket';

const TOKEN_KEY = 'aesyclaw_token';
const COOKIE_MAX_AGE_DAYS = 30;

function setCookie(name: string, value: string): void {
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Strict; max-age=${maxAge}`;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match?.[2] ? decodeURIComponent(match[2]) : null;
}

function removeCookie(name: string): void {
  document.cookie = `${name}=; path=/; max-age=0`;
}

const initialToken = sessionStorage.getItem(TOKEN_KEY) ?? getCookie(TOKEN_KEY);
const token = ref<string | null>(initialToken);

function login(newToken: string): void {
  token.value = newToken;
  sessionStorage.setItem(TOKEN_KEY, newToken);
  setCookie(TOKEN_KEY, newToken);
  const ws = useWebSocket();
  ws.connect(newToken);
}

function logout(): void {
  token.value = null;
  sessionStorage.removeItem(TOKEN_KEY);
  removeCookie(TOKEN_KEY);
  const ws = useWebSocket();
  ws.disconnect();
}

if (token.value) {
  const ws = useWebSocket();
  ws.connect(token.value);
}

watch(token, (newToken) => {
  const ws = useWebSocket();
  if (!newToken) {
    ws.disconnect();
  }
});

/**
 * 认证管理 composable。
 * token 持久化到 sessionStorage 和 cookie，登录/登出时同步管理 WebSocket 连接。
 *
 * @returns token ref 和 login、logout 方法
 */
export function useAuth() {
  return { token, login, logout };
}
