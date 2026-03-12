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
  min-width: 0;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: #1e293b;
  overflow-wrap: anywhere;
}

.page-subtitle {
  margin: 6px 0 0 0;
  font-size: 14px;
  line-height: 1.5;
  color: #64748b;
}

.page-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  max-width: 100%;
}

.page-header-actions :deep(.p-button),
.page-header-actions :deep(.p-inputtext),
.page-header-actions :deep(.p-select),
.page-header-actions :deep(.p-multiselect),
.page-header-actions :deep(.p-inputnumber),
.page-header-actions :deep(.p-password),
.page-header-actions :deep(.p-inputwrapper) {
  max-width: 100%;
}

@media (max-width: 768px) {
  .page-header {
    margin-bottom: 18px;
  }

  .page-header-content {
    flex-direction: column;
    align-items: stretch;
  }

  .page-title {
    font-size: 21px;
  }

  .page-header-actions {
    width: 100%;
    justify-content: stretch;
  }

  .page-header-actions :deep(.p-button),
  .page-header-actions :deep(.p-inputtext),
  .page-header-actions :deep(.p-select),
  .page-header-actions :deep(.p-multiselect),
  .page-header-actions :deep(.p-inputnumber),
  .page-header-actions :deep(.p-password),
  .page-header-actions :deep(.p-inputwrapper) {
    width: 100%;
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
