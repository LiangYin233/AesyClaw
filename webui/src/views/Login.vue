<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../lib/auth';
import { EyeIcon, EyeSlashIcon, BoltIcon } from '@heroicons/vue/24/solid';

const router = useRouter();
const { login, loading, error } = useAuth();

const password = ref('');
const showPassword = ref(false);
const isVisible = ref(false);

onMounted(() => {
  setTimeout(() => {
    isVisible.value = true;
  }, 100);
});

async function handleSubmit() {
  const success = await login(password.value);
  if (success) {
    router.push('/');
  }
}
</script>

<template>
  <div class="min-h-[100dvh] flex items-center justify-center p-4 relative overflow-hidden">
    <div class="absolute inset-0 overflow-hidden">
      <div class="absolute -top-[40%] -right-[20%] w-[80%] h-[80%] rounded-full blur-3xl opacity-20" style="background: var(--color-primary-container)" />
      <div class="absolute -bottom-[20%] -left-[20%] w-[60%] h-[60%] rounded-full blur-3xl opacity-10" style="background: var(--color-tertiary)" />
    </div>

    <div
      class="relative w-full max-w-md"
      :class="{ 'opacity-0 translate-y-4': !isVisible, 'opacity-100 translate-y-0': isVisible }"
      style="transition: opacity 0.5s ease, transform 0.5s ease"
    >
      <div
        class="rounded-2xl p-8 backdrop-blur-xl border"
        style="
          background: color-mix(in srgb, var(--color-surface-container-lowest) 85%, transparent);
          border-color: color-mix(in srgb, var(--color-outline-variant) 30%, transparent);
        "
      >
        <div class="flex flex-col items-center mb-8">
          <div
            class="w-14 h-14 rounded-xl flex items-center justify-center mb-4"
            style="background: var(--color-primary-container)"
          >
            <BoltIcon class="w-8 h-8" style="color: var(--color-on-primary-container)" />
          </div>
          <h1 class="text-2xl font-bold tracking-tight" style="color: var(--color-on-surface)">
            AesyClaw
          </h1>
          <p class="text-sm mt-1" style="color: var(--color-on-surface-variant)">
            Agent Framework Console
          </p>
        </div>

        <form @submit.prevent="handleSubmit" class="space-y-5">
          <div class="space-y-2">
            <label
              for="password"
              class="text-sm font-medium"
              style="color: var(--color-on-surface)"
            >
              Admin Password
            </label>
            <div class="relative">
              <input
                id="password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                required
                autocomplete="current-password"
                class="w-full px-4 py-3 pr-12 rounded-xl border transition-all duration-200 outline-none"
                style="
                  background: var(--color-surface-container-high);
                  border-color: var(--color-outline-variant);
                  color: var(--color-on-surface);
                "
                :class="{
                  'border-red-500': error,
                  'focus:border-[var(--color-primary)]': !error,
                }"
                placeholder="Enter your password"
                :disabled="loading"
              />
              <button
                type="button"
                @click="showPassword = !showPassword"
                class="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded transition-colors"
                style="color: var(--color-on-surface-variant)"
              >
                <EyeSlashIcon v-if="showPassword" class="w-5 h-5" />
                <EyeIcon v-else class="w-5 h-5" />
              </button>
            </div>
          </div>

          <Transition
            enter-active-class="transition-all duration-200"
            enter-from-class="opacity-0 -translate-y-2"
            leave-active-class="transition-all duration-150"
            leave-to-class="opacity-0"
          >
            <div
              v-if="error"
              class="p-3 rounded-xl text-sm"
              style="
                background: color-mix(in srgb, var(--color-error-container) 60%, transparent);
                color: var(--color-error);
              "
            >
              {{ error }}
            </div>
          </Transition>

          <button
            type="submit"
            :disabled="loading || !password"
            class="w-full py-3 px-4 rounded-xl font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99]"
            style="
              background: var(--color-primary-container);
              color: var(--color-on-primary-container);
            "
          >
            <span v-if="loading" class="flex items-center justify-center gap-2">
              <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                  fill="none"
                />
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Signing in...
            </span>
            <span v-else>Sign In</span>
          </button>
        </form>

        <div
          class="mt-6 pt-6 text-center text-xs border-t"
          style="border-color: var(--color-outline-variant); color: var(--color-outline)"
        >
          <p>Default password: <code class="px-1.5 py-0.5 rounded text-xs" style="background: var(--color-surface-container-high)">admin123</code></p>
        </div>
      </div>
    </div>
  </div>
</template>
