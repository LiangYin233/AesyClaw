<template>
  <div class="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-6">
    <div class="hairline-card max-w-xl rounded-3xl px-8 py-10 text-center">
      <div class="mx-auto flex size-20 items-center justify-center rounded-full bg-surface-container-low text-outline">
        <AppIcon name="deployed" size="xl" />
      </div>
      <p class="cn-kicker mt-6 text-outline">{{ title }}</p>
      <h2 class="mt-2 text-[1.8rem] font-bold tracking-[-0.02em] text-on-surface">模块正在迁移到新版控制台</h2>
      <p class="cn-body mt-4 text-sm text-on-surface-variant">{{ description }}</p>
      <router-link :to="{ path: '/overview', query: token ? { token } : {} }" class="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:opacity-90">
        返回总览
        <AppIcon name="arrowRight" size="sm" />
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import { getRouteToken } from '@/lib/auth';

const route = useRoute();
const token = getRouteToken(route);

const title = computed(() => String(route.meta.title || '控制台'));
const description = computed(() => String(route.meta.description || '该模块已经挂入新版壳层，但业务页面仍在迁移中。'));
</script>
