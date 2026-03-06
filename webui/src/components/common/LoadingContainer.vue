<template>
  <div class="loading-container">
    <div v-if="loading" class="loading-overlay" role="status" aria-live="polite">
      <ProgressSpinner :aria-label="loadingText" />
      <span class="sr-only">{{ loadingText }}</span>
      <p v-if="showText" class="loading-text">{{ loadingText }}</p>
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

interface Props {
  loading?: boolean
  error?: string | null
  loadingText?: string
  errorTitle?: string
  showText?: boolean
  onRetry?: () => void
}

withDefaults(defineProps<Props>(), {
  loading: false,
  error: null,
  loadingText: '正在加载...',
  errorTitle: '加载失败',
  showText: true
})
</script>

<style scoped>
.loading-container {
  position: relative;
  min-height: 200px;
}

.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 16px;
}

.loading-text {
  margin: 0;
  font-size: 14px;
  color: #64748b;
}

.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px 24px;
  background: #fee2e2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  text-align: center;
}

.error-icon {
  font-size: 32px;
  color: #dc2626;
}

.error-content {
  flex: 1;
}

.error-title {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: #991b1b;
}

.error-message {
  margin: 0;
  font-size: 14px;
  color: #dc2626;
}

@media (prefers-color-scheme: dark) {
  .loading-text {
    color: #94a3b8;
  }

  .error-container {
    background: #7f1d1d;
    border-color: #991b1b;
  }

  .error-icon {
    color: #fca5a5;
  }

  .error-title {
    color: #fecaca;
  }

  .error-message {
    color: #fca5a5;
  }
}
</style>
