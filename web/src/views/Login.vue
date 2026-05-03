<template>
  <div class="flex flex-col min-h-screen bg-light">
    <div class="flex-1 flex items-center justify-center p-8">
      <div
        class="bg-light border border-[var(--color-border)] rounded-xl p-10 w-full max-w-[420px] shadow text-center"
      >
        <img src="/groupLogo.svg" alt="AesyClaw" class="w-40 h-auto mb-6 mx-auto" />

        <form @submit.prevent="handleSubmit" class="text-left">
          <div class="mb-5">
            <label class="block mb-2 font-body text-sm font-medium text-dark" :for="tokenId"
              >Auth Token</label
            >
            <div class="relative flex items-center">
              <input
                :id="tokenId"
                v-model="tokenInput"
                :type="showToken ? 'text' : 'password'"
                class="w-full py-[0.7rem] pr-10 pl-[0.9rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                placeholder="Paste your auth token"
                required
              />
              <button
                type="button"
                class="absolute right-[0.6rem] top-1/2 -translate-y-1/2 bg-none border-none cursor-pointer text-mid-gray p-[0.2rem] flex items-center justify-center transition-colors duration-[0.15s] ease hover:text-dark"
                @click="showToken = !showToken"
              >
                <svg
                  v-if="showToken"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                  ></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
                <svg
                  v-else
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
            </div>
          </div>

          <button
            type="submit"
            class="w-full inline-flex items-center justify-center gap-2 py-3 px-4 border-none rounded-sm bg-[#9c6f3c] text-white font-heading text-sm font-medium cursor-pointer transition-all duration-[0.15s] ease hover:bg-[#8a6234] hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(156,111,60,0.25)] disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
            :disabled="loading"
          >
            <span>{{ loading ? 'Verifying...' : 'Verify & Sign In' }}</span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>

          <p v-if="error" class="text-danger text-sm mt-3 text-center font-body">{{ error }}</p>
        </form>

        <div
          class="flex items-start gap-2 mt-6 pt-5 border-t border-[var(--color-border)] text-left"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#788c5d"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="shrink-0 mt-[0.15rem]"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          <span class="font-body text-xs text-mid-gray leading-[1.4]"
            >Your token is never stored on our servers. All requests are secured and
            encrypted.</span
          >
        </div>
      </div>
    </div>

    <footer class="p-5 text-center font-body text-xs text-mid-gray">
      <span>&copy; 2026 AesyClaw. All rights reserved.</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, useId } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '@/composables/useAuth';

const router = useRouter();
const { login, api } = useAuth();
const tokenId = useId();

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
