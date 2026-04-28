<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <span class="brand-icon">🤖</span>
        <h1>AesyClaw</h1>
        <p>Admin Panel</p>
      </div>
      <form class="login-form" @submit.prevent="handleSubmit">
        <div class="form-group">
          <label for="token">Auth Token</label>
          <input
            id="token"
            v-model="tokenInput"
            type="password"
            class="form-input"
            placeholder="Paste your auth token"
            required
          />
        </div>
        <button type="submit" class="btn btn-primary btn-block" :disabled="loading">
          {{ loading ? 'Verifying...' : 'Sign In' }}
        </button>
        <p v-if="error" class="form-error">{{ error }}</p>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '@/composables/useAuth';

const router = useRouter();
const { login, api } = useAuth();

const tokenInput = ref('');
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
