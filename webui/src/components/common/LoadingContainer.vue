<template>
  <div class="loading-container">
    <div v-if="loading" class="loading-surface" role="status" aria-live="polite">
      <ProgressSpinner :aria-label="loadingText" />
      <span class="sr-only">{{ loadingText }}</span>
      <p v-if="showText" class="loading-text">{{ loadingText }}</p>
      <div v-if="showSkeleton" class="loading-skeletons" aria-hidden="true">
        <Skeleton v-for="item in 3" :key="item" class="loading-skeleton" height="1rem" borderRadius="999px" />
      </div>
    </div>

    <div v-else-if="error" class="error-container" role="alert">
      <i class="pi pi-exclamation-triangle error-icon" aria-hidden="true"></i>
      <div class="error-content">
        <p class="error-title">{{ errorTitle }}</p>
        <p class="error-message">{{ error }}</p>
      </div>
      <Button
        v-if="onRetry"
        label="重试"
        icon="pi pi-refresh"
        severity="secondary"
        @click="onRetry"
        aria-label="重试加载"
      />
    </div>

    <slot v-else></slot>
  </div>
</template>

<script setup lang="ts">
import ProgressSpinner from 'primevue/progressspinner'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'

interface Props {
  loading?: boolean
  error?: string | null
  loadingText?: string
  errorTitle?: string
  showText?: boolean
  showSkeleton?: boolean
  onRetry?: () => void
}

withDefaults(defineProps<Props>(), {
  loading: false,
  error: null,
  loadingText: '正在加载...',
  errorTitle: '加载失败',
  showText: true,
  showSkeleton: true
})
</script>

<style scoped>
.loading-container {
  position: relative;
  min-height: 220px;
}

.loading-surface,
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--ui-space-4);
  min-height: 240px;
  padding: var(--ui-space-8) var(--ui-space-6);
  border-radius: var(--ui-radius-md);
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-sm);
  text-align: center;
}

.loading-text {
  margin: 0;
  font-size: 0.95rem;
  color: var(--ui-text-muted);
}

.loading-skeletons {
  width: min(380px, 100%);
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-3);
}

.loading-skeleton {
  opacity: 0.7;
}

.error-container {
  background: linear-gradient(180deg, rgba(254, 242, 242, 0.95), rgba(254, 226, 226, 0.9));
  border-color: rgba(248, 113, 113, 0.26);
}

.error-icon {
  font-size: 2rem;
  color: #dc2626;
}

.error-content {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
}

.error-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: #991b1b;
}

.error-message {
  margin: 0;
  max-width: 58ch;
  font-size: 0.92rem;
  line-height: 1.6;
  color: #b91c1c;
}

@media (prefers-color-scheme: dark) {
  .error-container {
    background: linear-gradient(180deg, rgba(69, 10, 10, 0.84), rgba(127, 29, 29, 0.74));
    border-color: rgba(248, 113, 113, 0.22);
  }

  .error-title {
    color: #fecaca;
  }

  .error-message,
  .error-icon {
    color: #fca5a5;
  }
}
</style>
