<template>
  <div class="password-field">
    <input
      class="ui-input"
      :type="visible ? 'text' : 'password'"
      :value="modelValue ?? ''"
      v-bind="$attrs"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <button v-if="toggleMask" class="password-toggle" type="button" @click="visible = !visible">
      {{ visible ? '隐藏' : '显示' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineOptions({ inheritAttrs: false })

interface Props {
  modelValue?: string | null
  toggleMask?: boolean
}

withDefaults(defineProps<Props>(), {
  modelValue: '',
  toggleMask: false
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const visible = ref(false)
</script>

<style scoped>
.password-field {
  position: relative;
}

.ui-input {
  width: 100%;
  min-height: 2.8rem;
  padding: 0 4.4rem 0 0.9rem;
  border-radius: 0.95rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-input-bg);
  color: var(--ui-text);
}

.password-toggle {
  position: absolute;
  top: 50%;
  right: 0.6rem;
  transform: translateY(-50%);
  border: none;
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
}
</style>
