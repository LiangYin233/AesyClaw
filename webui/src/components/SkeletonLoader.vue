<script setup lang="ts">
defineProps<{
  variant?: 'text' | 'card' | 'avatar' | 'button';
  width?: string;
  height?: string;
}>();
</script>

<template>
  <div
    class="skeleton animate-pulse rounded"
    :class="{
      'h-4 w-full': variant === 'text',
      'h-32 w-full rounded-lg': variant === 'card',
      'w-12 h-12 rounded-full': variant === 'avatar',
      'h-10 w-24 rounded-lg': variant === 'button',
    }"
    :style="{
      width: width && !variant ? width : undefined,
      height: height && !variant ? height : undefined,
    }"
  />
</template>

<style scoped>
.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-surface-container-high, #1b2940) 25%,
    var(--color-surface-container-highest, #243550) 50%,
    var(--color-surface-container-high, #1b2940) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
