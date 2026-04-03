<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../lib/auth';

const router = useRouter();
const { login, loading, error } = useAuth();

const password = ref('');

async function handleSubmit() {
  const success = await login(password.value);
  if (success) {
    router.push('/');
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-900">
    <div class="w-full max-w-md p-8 space-y-6 bg-gray-800 rounded-lg shadow-xl">
      <div class="text-center">
        <h1 class="text-3xl font-bold text-white mb-2">AesyClaw</h1>
        <p class="text-gray-400">Agent Framework Console</p>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label for="password" class="block text-sm font-medium text-gray-300 mb-2">
            Admin Password
          </label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter password"
            :disabled="loading"
          />
        </div>

        <div v-if="error" class="p-3 bg-red-900/50 border border-red-700 rounded-lg">
          <p class="text-sm text-red-300">{{ error }}</p>
        </div>

        <button
          type="submit"
          :disabled="loading || !password"
          class="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          <span v-if="loading" class="flex items-center justify-center gap-2">
            <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Signing in...
          </span>
          <span v-else>Sign In</span>
        </button>
      </form>

      <div class="text-center text-xs text-gray-500">
        <p>Default password: admin123</p>
      </div>
    </div>
  </div>
</template>
