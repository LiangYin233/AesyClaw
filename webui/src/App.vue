<script setup lang="ts">
import { RouterView } from 'vue-router';
import PageTransition from './components/PageTransition.vue';
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <PageTransition>
      <component :is="Component" :key="route.path" />
    </PageTransition>
  </RouterView>
</template>
