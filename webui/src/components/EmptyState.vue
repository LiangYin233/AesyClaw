<script setup lang="ts">
import { HomeIcon, ArrowPathIcon, InboxIcon } from '@heroicons/vue/24/outline';

defineProps<{
  title?: string;
  description?: string;
  actionText?: string;
  variant?: 'empty' | 'error' | 'loading';
}>();

defineEmits<{
  action: [];
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
    <div
      class="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
      :class="{
        'bg-blue-500/10': variant === 'empty' || !variant,
        'bg-red-500/10': variant === 'error',
        'bg-gray-500/10': variant === 'loading',
      }"
    >
      <InboxIcon
        v-if="variant === 'empty' || !variant"
        class="w-8 h-8 text-blue-400"
      />
      <ArrowPathIcon
        v-else-if="variant === 'error'"
        class="w-8 h-8 text-red-400"
      />
      <div
        v-else
        class="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
        :class="{ 'border-gray-400': variant === 'loading' }"
      />
    </div>

    <h3 class="text-lg font-semibold mb-2" style="color: var(--color-on-surface)">
      {{ title || (variant === 'error' ? 'Something went wrong' : 'No data yet') }}
    </h3>

    <p class="text-sm max-w-sm mb-6" style="color: var(--color-on-surface-variant)">
      {{ description || (variant === 'error' ? 'An error occurred while loading data.' : 'There is no data to display at the moment.') }}
    </p>

    <button
      v-if="actionText && variant !== 'loading'"
      @click="$emit('action')"
      class="px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
      style="background: var(--color-primary-container); color: var(--color-on-primary-container)"
    >
      {{ actionText }}
    </button>
  </div>
</template>
