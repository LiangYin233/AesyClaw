import { ref } from 'vue';

export interface ToastState {
  type: string;
  message: string;
}

const toast = ref<ToastState | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

export function useToast() {
  function showToast(type: ToastState['type'], message: string): void {
    toast.value = { type, message };
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      toast.value = null;
      timer = null;
    }, 3000);
  }

  return {
    toast,
    showToast,
  };
}
