<template>
  <teleport to="body">
    <div class="ui-toast-viewport" aria-live="polite" aria-atomic="true">
      <transition-group name="ui-toast">
        <div v-for="toast in uiStore.toasts" :key="toast.id" class="ui-toast" :class="`ui-toast--${toast.severity}`">
          <div class="ui-toast__copy">
            <strong>{{ toast.summary }}</strong>
            <p v-if="toast.detail">{{ toast.detail }}</p>
          </div>
          <button class="ui-toast__close" type="button" @click="uiStore.removeToast(toast.id)">
            <UiIcon name="times" />
          </button>
        </div>
      </transition-group>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { useUiStore } from '../../stores'
import UiIcon from './UiIcon.vue'

const uiStore = useUiStore()
</script>

<style scoped>
.ui-toast-viewport {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  width: min(360px, calc(100vw - 2rem));
}

.ui-toast {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.9rem 1rem;
  border-radius: 1rem;
  border: 1px solid transparent;
  background: var(--ui-panel-strong);
  box-shadow: var(--ui-shadow-md);
}

.ui-toast__copy strong {
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.92rem;
}

.ui-toast__copy p {
  margin: 0;
  font-size: 0.84rem;
  line-height: 1.5;
}

.ui-toast__close {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.ui-toast--success { border-color: color-mix(in srgb, var(--ui-success) 18%, transparent); background: color-mix(in srgb, var(--ui-success-soft) 72%, var(--ui-panel-strong)); color: var(--ui-success-text); }
.ui-toast--info { border-color: color-mix(in srgb, var(--ui-info) 18%, transparent); background: color-mix(in srgb, var(--ui-info-soft) 72%, var(--ui-panel-strong)); color: var(--ui-info-text); }
.ui-toast--warn { border-color: color-mix(in srgb, var(--ui-warning) 18%, transparent); background: color-mix(in srgb, var(--ui-warning-soft) 72%, var(--ui-panel-strong)); color: var(--ui-warning-text); }
.ui-toast--error { border-color: color-mix(in srgb, var(--ui-danger) 18%, transparent); background: color-mix(in srgb, var(--ui-danger-soft) 72%, var(--ui-panel-strong)); color: var(--ui-danger-text); }

.ui-toast-enter-active,
.ui-toast-leave-active {
  transition: all 0.2s ease;
}

.ui-toast-enter-from,
.ui-toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
