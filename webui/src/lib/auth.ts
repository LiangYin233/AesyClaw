import { ref, computed } from 'vue';
import { login as apiLogin, logout as apiLogout, verifyToken, isAuthenticated as checkAuth } from './api';

const token = ref<string | null>(localStorage.getItem('auth_token'));
const user = ref<{ userId: string; role: string } | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

export function useAuth() {
  const isAuthenticated = computed(() => !!token.value);

  async function login(password: string): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      const response = await apiLogin(password);
      token.value = response.token;
      user.value = { userId: 'admin', role: 'admin' };
      localStorage.setItem('auth_token', response.token);
      return true;
    } catch (err: any) {
      error.value = err.body?.error || err.message || 'Login failed';
      return false;
    } finally {
      loading.value = false;
    }
  }

  function logout(): void {
    apiLogout();
    token.value = null;
    user.value = null;
    localStorage.removeItem('auth_token');
  }

  async function checkAuthStatus(): Promise<boolean> {
    if (!token.value) {
      return false;
    }

    try {
      const response = await verifyToken();
      if (response.valid) {
        user.value = { userId: 'admin', role: 'admin' };
        return true;
      }
      logout();
      return false;
    } catch {
      logout();
      return false;
    }
  }

  return {
    token,
    user,
    loading,
    error,
    isAuthenticated,
    login,
    logout,
    checkAuthStatus,
  };
}
