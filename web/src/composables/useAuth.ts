import axios, { type AxiosInstance } from 'axios';
import { ref } from 'vue';

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

const api: AxiosInstance = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  if (token.value) {
    config.headers.Authorization = `Bearer ${token.value}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      logout();
      if (window.location.hash !== '#/login') {
        window.location.hash = '#/login';
      }
    }
    return Promise.reject(error);
  },
);

function login(newToken: string): void {
  token.value = newToken;
  sessionStorage.setItem(TOKEN_KEY, newToken);
  setCookie(TOKEN_KEY, newToken);
}

function logout(): void {
  token.value = null;
  sessionStorage.removeItem(TOKEN_KEY);
  removeCookie(TOKEN_KEY);
}

/**
 * Global authentication composable (module-level singleton).
 *
 * All state (`token`, `api`, `login`, `logout`) is shared across every caller.
 * This is intentional — auth state must be app-wide, not per-component.
 */
export function useAuth() {
  return {
    token,
    login,
    logout,
    api,
  };
}
