<template>
  <teleport to="body">
    <transition name="ui-dialog-fade">
      <div v-if="visible" class="ui-dialog__overlay" @click="closeOnOverlay">
        <div class="ui-dialog" :class="{ 'ui-dialog--drawer': drawer }" :style="styleObject" role="dialog" aria-modal="true" @click.stop>
          <header class="ui-dialog__header">
            <div class="ui-dialog__title">{{ header }}</div>
            <button class="ui-dialog__close" type="button" @click="emit('update:visible', false)">
              <UiIcon name="times" />
            </button>
          </header>
          <div class="ui-dialog__content">
            <slot></slot>
          </div>
          <footer v-if="$slots.footer" class="ui-dialog__footer">
            <slot name="footer"></slot>
          </footer>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import UiIcon from './UiIcon.vue'

interface Props {
  visible: boolean
  header?: string
  modal?: boolean
  style?: Record<string, string> | string
  drawer?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  header: '',
  modal: true,
  style: undefined,
  drawer: false
})

const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const styleObject = computed(() => {
  if (!props.style) {
    return props.drawer ? { width: 'min(560px, 100vw)', height: '100vh' } : { width: 'min(640px, calc(100vw - 2rem))' }
  }

  if (typeof props.style === 'string') {
    return {}
  }

  return props.style
})

function closeOnOverlay() {
  if (props.modal) {
    emit('update:visible', false)
  }
}
</script>

<style scoped>
.ui-dialog__overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(12px);
}

.ui-dialog {
  width: min(640px, calc(100vw - 2rem));
  max-height: calc(100vh - 2rem);
  border-radius: 1.4rem;
  border: 1px solid var(--ui-border-strong);
  background: var(--ui-panel-strong);
  box-shadow: var(--ui-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ui-dialog--drawer {
  margin-left: auto;
  width: min(560px, 100vw);
  max-height: 100vh;
  height: 100vh;
  border-radius: 0;
}

.ui-dialog__header,
.ui-dialog__content,
.ui-dialog__footer {
  padding: 1.2rem 1.25rem;
}

.ui-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--ui-border-subtle);
}

.ui-dialog__title {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--ui-text-strong);
}

.ui-dialog__close {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
}

.ui-dialog__content {
  overflow: auto;
  color: var(--ui-text-soft);
}

.ui-dialog__footer {
  border-top: 1px solid var(--ui-border-subtle);
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.ui-dialog-fade-enter-active,
.ui-dialog-fade-leave-active {
  transition: opacity 0.2s ease;
}

.ui-dialog-fade-enter-from,
.ui-dialog-fade-leave-to {
  opacity: 0;
}
</style>
