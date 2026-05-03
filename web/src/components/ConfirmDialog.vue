<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-[rgba(20,20,19,0.4)] backdrop-blur-sm flex items-center justify-center z-[100] animate-[fadeIn_0.2s_ease]"
      @click.self="$emit('cancel')"
    >
      <div
        class="bg-light border border-[var(--color-border)] rounded p-7 w-full max-w-[440px] shadow-lg animate-[slideUp_0.3s_cubic-bezier(0.16,1,0.3,1)]"
      >
        <h3 class="font-heading text-lg font-semibold text-dark tracking-[-0.01em] mb-3">
          {{ title }}
        </h3>
        <p class="font-body text-sm text-dark mb-0">{{ message }}</p>
        <div class="flex justify-end gap-2.5 mt-6">
          <button
            class="inline-flex items-center justify-center gap-1.5 px-[1.1rem] py-[0.55rem] border border-[var(--color-border)] rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-transparent text-mid-gray hover:bg-light-gray hover:text-dark hover:border-mid-gray"
            @click="$emit('cancel')"
          >
            Cancel
          </button>
          <button
            class="inline-flex items-center justify-center gap-1.5 px-[1.1rem] py-[0.55rem] border border-transparent rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-[#CF3A3A] text-white hover:bg-[#b83333] hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(207,58,58,0.25)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
            @click="$emit('confirm')"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  message: string;
  confirmText?: string;
}>();

defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();
</script>
