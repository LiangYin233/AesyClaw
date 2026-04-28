import axios, { type AxiosInstance } from 'axios';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const TOKEN_KEY = 'aesyclaw_token';
const token = ref<string | null>(sessionStorage.getItem(TOKEN_KEY));

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
      const router = useRouter();
      router.push('/login');
    }
    return Promise.reject(error);
  }
);

function login(newToken: string): void {
  token.value = newToken;
  sessionStorage.setItem(TOKEN_KEY, newToken);
}

function logout(): void {
  token.value = null;
  sessionStorage.removeItem(TOKEN_KEY);
}

export function useAuth() {
  return {
    token,
    login,
    logout,
    api,
  };
}
