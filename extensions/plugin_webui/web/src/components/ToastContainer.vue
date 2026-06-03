<template>
  <div
    v-if="toast"
    class="fixed top-5 right-5 px-5 py-[0.85rem] rounded-sm text-white font-heading font-medium text-sm z-[200] animate-[slideInRight_0.3s_cubic-bezier(0.16,1,0.3,1)] shadow-lg"
    :class="toast.type === 'toast-success' ? 'bg-accent-green' : 'bg-danger'"
  >
    {{ toast.message }}
  </div>
</template>

<script setup lang="ts">
import { useToast } from '@/composables/useToast';

const { toast } = useToast();
</script>
