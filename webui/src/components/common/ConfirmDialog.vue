<template>
  <Dialog v-model:visible="visibleModel" :header="title" modal :style="{ width: '450px' }">
    <div class="confirm-content">
      <UiIcon name="warning" size="lg" class="confirm-icon" />
      <span>{{ message }}</span>
    </div>
    <template #footer>
      <Button label="取消" text @click="visibleModel = false" :disabled="loading" />
      <Button :label="confirmLabel" :severity="confirmSeverity" :loading="loading" @click="onConfirm?.()" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import UiIcon from '../ui/UiIcon.vue'

interface Props {
  visible: boolean
  title: string
  message: string
  loading?: boolean
  confirmLabel?: string
  confirmSeverity?: 'danger' | 'warning' | 'info' | 'success' | 'secondary'
  onConfirm?: () => void | Promise<void>
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  confirmLabel: '确认',
  confirmSeverity: 'danger',
  onConfirm: undefined
})

const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const visibleModel = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value)
})
</script>

<style scoped>
.confirm-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.confirm-icon {
  color: var(--ui-warning);
}
</style>
