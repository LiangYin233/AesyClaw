<template>
  <header class="page-header">
    <div class="page-header__surface">
      <div class="page-header__main">
        <div class="page-header__copy">
          <h1 :id="titleId" class="page-title">{{ title }}</h1>
          <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
        </div>
        <div v-if="$slots.actions" class="page-header__actions">
          <slot name="actions"></slot>
        </div>
      </div>
      <div v-if="$slots.notice" class="page-header__notice">
        <slot name="notice"></slot>
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
  margin-bottom: var(--ui-space-2);
}

.page-header__surface {
  padding: var(--ui-space-5);
  border-radius: var(--ui-radius-lg);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.84)),
    linear-gradient(180deg, rgba(37, 99, 235, 0.08), transparent 50%);
  border: 1px solid var(--ui-border);
  box-shadow: var(--ui-shadow-sm);
  backdrop-filter: blur(18px);
}

.page-header__main {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--ui-space-4);
}

.page-header__copy {
  flex: 1;
  min-width: 0;
}

.page-title {
  margin: 0;
  font-size: clamp(1.6rem, 2vw, 2rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--ui-text);
  overflow-wrap: anywhere;
}

.page-subtitle {
  margin: 8px 0 0 0;
  max-width: 70ch;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--ui-text-muted);
}

.page-header__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--ui-space-3);
  flex-wrap: wrap;
  max-width: 100%;
}

.page-header__actions :deep(.p-button),
.page-header__actions :deep(.p-inputtext),
.page-header__actions :deep(.p-select),
.page-header__actions :deep(.p-multiselect),
.page-header__actions :deep(.p-inputnumber),
.page-header__actions :deep(.p-password),
.page-header__actions :deep(.p-inputwrapper) {
  max-width: 100%;
}

.page-header__notice {
  margin-top: var(--ui-space-4);
}

@media (max-width: 768px) {
  .page-header__surface {
    padding: var(--ui-space-4);
  }

  .page-header__main {
    flex-direction: column;
    align-items: stretch;
  }

  .page-header__actions {
    width: 100%;
    justify-content: stretch;
  }

  .page-header__actions :deep(.p-button),
  .page-header__actions :deep(.p-inputtext),
  .page-header__actions :deep(.p-select),
  .page-header__actions :deep(.p-multiselect),
  .page-header__actions :deep(.p-inputnumber),
  .page-header__actions :deep(.p-password),
  .page-header__actions :deep(.p-inputwrapper) {
    width: 100%;
  }
}

@media (prefers-color-scheme: dark) {
  .page-header__surface {
    background:
      linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.84)),
      linear-gradient(180deg, rgba(37, 99, 235, 0.16), transparent 52%);
  }
}
</style>
