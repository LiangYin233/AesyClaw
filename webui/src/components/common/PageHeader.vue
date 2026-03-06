<template>
  <header class="page-header">
    <div class="page-header-content">
      <div class="page-header-left">
        <h1 :id="titleId" class="page-title">{{ title }}</h1>
        <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="page-header-actions">
        <slot name="actions"></slot>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useUniqueId } from '../../composables/useA11y'

interface Props {
  title: string
  subtitle?: string
}

defineProps<Props>()

const titleId = useUniqueId('page-title')
</script>

<style scoped>
.page-header {
  margin-bottom: 24px;
}

.page-header-content {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.page-header-left {
  flex: 1;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: bold;
  color: #1e293b;
}

.page-subtitle {
  margin: 4px 0 0 0;
  font-size: 14px;
  color: #64748b;
}

.page-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 768px) {
  .page-header-content {
    flex-direction: column;
    align-items: stretch;
  }

  .page-header-actions {
    width: 100%;
    justify-content: flex-start;
  }
}

@media (prefers-color-scheme: dark) {
  .page-title {
    color: #f1f5f9;
  }

  .page-subtitle {
    color: #94a3b8;
  }
}
</style>
