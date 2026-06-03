<template>
  <button
    type="button"
    class="w-11 h-6 rounded-full border-none cursor-pointer relative transition-colors duration-[0.15s] ease p-0"
    :class="model ? 'bg-accent-green' : 'bg-mid-gray'"
    @click="model = !model"
  >
    <span
      class="absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-transform duration-[0.15s] ease"
      :class="{ 'translate-x-5': model }"
    ></span>
  </button>
</template>

<script setup lang="ts">
const model = defineModel<boolean>({ required: true });
</script>
