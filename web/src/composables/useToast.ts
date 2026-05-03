import { ref } from 'vue';

export interface ToastState {
  type: string;
  message: string;
}

export function useToast() {
  const toast = ref<ToastState | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function showToast(type: string, message: string) {
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
