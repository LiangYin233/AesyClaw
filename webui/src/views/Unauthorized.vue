<template>
  <div class="flex min-h-screen items-center justify-center bg-surface p-6">
    <div class="hairline-card max-w-lg rounded-3xl px-8 py-10">
      <div class="flex size-16 items-center justify-center rounded-2xl bg-error-container text-error">
        <AppIcon name="warning" />
      </div>
      <p class="cn-kicker mt-6 text-outline">未授权</p>
      <h1 class="mt-2 text-[2.2rem] font-extrabold text-on-surface">缺少访问 token</h1>
      <p class="cn-body mt-4 text-sm text-on-surface-variant">当前控制台要求通过 `?token=` 访问后端 API。请使用带 token 的链接重新打开，例如 `http://localhost:3000/overview?token=你的token`。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue';
</script>
