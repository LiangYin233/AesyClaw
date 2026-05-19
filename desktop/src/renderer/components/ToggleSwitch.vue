<template>
  <button
    type="button"
    class="toggle-switch"
    :class="{ on: modelValue, disabled }"
    :aria-pressed="modelValue"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="toggle-knob"></span>
  </button>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();
</script>

<style scoped>
.toggle-switch {
  width: 44px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--color-mid-gray);
  cursor: pointer;
  position: relative;
  transition: background var(--transition-fast);
}

.toggle-switch.on {
  background: var(--color-accent-green);
}

.toggle-switch.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: transform var(--transition-fast);
}

.toggle-switch.on .toggle-knob {
  transform: translateX(20px);
}
</style>
