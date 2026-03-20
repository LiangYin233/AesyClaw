<template>
  <label class="ui-checkbox">
    <input
      :id="inputId"
      class="ui-checkbox__input"
      type="checkbox"
      :checked="Boolean(modelValue)"
      v-bind="$attrs"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="ui-checkbox__box"></span>
    <span v-if="$slots.default" class="ui-checkbox__label"><slot></slot></span>
  </label>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })

interface Props {
  modelValue?: boolean
  inputId?: string
}

withDefaults(defineProps<Props>(), {
  modelValue: false,
  inputId: undefined
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<style scoped>
.ui-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  cursor: pointer;
}

.ui-checkbox__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.ui-checkbox__box {
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 0.35rem;
  border: 1px solid var(--ui-border-strong);
  background: var(--ui-input-bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.ui-checkbox__box::after {
  content: '';
  width: 0.55rem;
  height: 0.3rem;
  border-left: 2px solid transparent;
  border-bottom: 2px solid transparent;
  transform: rotate(-45deg) translateY(-1px);
}

.ui-checkbox__input:checked + .ui-checkbox__box {
  background: var(--ui-accent);
  border-color: var(--ui-accent);
}

.ui-checkbox__input:checked + .ui-checkbox__box::after {
  border-color: var(--ui-on-accent);
}

.ui-checkbox__input:focus-visible + .ui-checkbox__box {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-accent) 12%, transparent);
}

.ui-checkbox__label {
  color: var(--ui-text-soft);
}
</style>
