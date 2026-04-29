<template>
  <div class="login-page">
    <!-- Login card -->
    <div class="login-card-wrapper">
      <div class="login-card">
        <img src="/groupLogo.svg" alt="AesyClaw" class="login-logo" />

        <form class="login-form" @submit.prevent="handleSubmit">
          <div class="login-form-group">
            <label class="login-label" for="token">Auth Token</label>
            <div class="login-input-wrap">
              <input
                id="token"
                v-model="tokenInput"
                :type="showToken ? 'text' : 'password'"
                class="login-input"
                placeholder="Paste your auth token"
                required
              />
              <button type="button" class="login-eye-btn" @click="showToken = !showToken">
                <svg v-if="showToken" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
            </div>
          </div>

          <button type="submit" class="login-btn" :disabled="loading">
            <span>{{ loading ? 'Verifying...' : 'Verify & Sign In' }}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>

          <p v-if="error" class="login-error">{{ error }}</p>
        </form>

        <div class="login-hint">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#788c5d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          <span>Your token is never stored on our servers. All requests are secured and encrypted.</span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer class="login-footer">
      <span>&copy; 2026 AesyClaw. All rights reserved.</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '@/composables/useAuth';

const router = useRouter();
const { login, api } = useAuth();

const tokenInput = ref('');
const showToken = ref(false);
const loading = ref(false);
const error = ref('');

async function handleSubmit() {
  loading.value = true;
  error.value = '';
  try {
    login(tokenInput.value);
    const res = await api.get('/status');
    if (res.data.ok) {
      router.push('/');
    } else {
      error.value = 'Invalid token';
    }
  } catch {
    error.value = 'Invalid token or server unreachable';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--color-bg);
}

/* Card wrapper */
.login-card-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.login-card {
  background: var(--color-light);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 2.5rem;
  width: 100%;
  max-width: 420px;
  box-shadow: var(--shadow);
  text-align: center;
}

.login-logo {
  width: 160px;
  height: auto;
  margin-bottom: 1.5rem;
}

.login-title {
  font-family: var(--font-heading);
  font-size: 1.6rem;
  font-weight: 600;
  color: var(--color-dark);
  margin-bottom: 0.5rem;
  letter-spacing: -0.02em;
}

/* Form */
.login-form-group {
  margin-bottom: 1.25rem;
  text-align: left;
}

.login-label {
  display: block;
  margin-bottom: 0.5rem;
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--color-dark);
}

.login-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.login-input {
  width: 100%;
  padding: 0.7rem 2.5rem 0.7rem 0.9rem;
  background: var(--color-light);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: 0.9rem;
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.login-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(217, 119, 87, 0.12);
}

.login-eye-btn {
  position: absolute;
  right: 0.6rem;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color var(--transition-fast);
}

.login-eye-btn:hover {
  color: var(--color-dark);
}

.login-btn {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border: none;
  border-radius: var(--radius-sm);
  background: #9c6f3c;
  color: #fff;
  font-family: var(--font-heading);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.login-btn:hover {
  background: #8a6234;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(156, 111, 60, 0.25);
}

.login-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.login-error {
  color: var(--color-danger);
  font-size: 0.85rem;
  margin-top: 0.75rem;
  text-align: center;
}

/* Hint */
.login-hint {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--color-border);
  text-align: left;
}

.login-hint svg {
  flex-shrink: 0;
  margin-top: 0.15rem;
}

.login-hint span {
  font-family: var(--font-body);
  font-size: 0.8rem;
  color: var(--color-text-muted);
  line-height: 1.4;
}

/* Footer */
.login-footer {
  padding: 1.25rem;
  text-align: center;
  font-family: var(--font-body);
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
</style>
