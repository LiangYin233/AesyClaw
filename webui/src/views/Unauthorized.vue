<template>
  <div class="flex min-h-screen items-center justify-center bg-surface p-6">
    <div class="hairline-card max-w-lg rounded-3xl px-8 py-10">
      <div class="flex size-16 items-center justify-center rounded-2xl bg-error-container text-error">
        <AppIcon name="warning" />
      </div>
      <p class="cn-kicker mt-6 text-outline">未授权</p>
      <h1 class="mt-2 text-[2.2rem] font-extrabold text-on-surface">未提供访问凭证</h1>
      <p class="cn-body mt-4 text-sm text-on-surface-variant">请在浏览器地址栏中添加 `?token=你的凭证` 参数后重新访问。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue';
</script>
