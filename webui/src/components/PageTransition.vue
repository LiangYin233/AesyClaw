<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const isTransitioning = ref(false);

route.meta;
</script>

<template>
  <Transition
    name="page"
    mode="out-in"
    @before-leave="isTransitioning = true"
    @after-enter="isTransitioning = false"
  >
    <div
      :key="route.path"
      class="h-full"
      :class="{ 'opacity-50': isTransitioning }"
    >
      <slot />
    </div>
  </Transition>
</template>

<style scoped>
.page-enter-active,
.page-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
