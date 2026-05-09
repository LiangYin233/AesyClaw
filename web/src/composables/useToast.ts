import { ref } from 'vue';

/** Toast 通知状态 */
export interface ToastState {
  type: string;
  message: string;
}

const toast = ref<ToastState | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Toast 通知 composable。
 * 提供全局 Toast 状态和显示方法，3秒后自动消失。
 *
 * @returns toast 状态 ref 和 showToast 方法
 */
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
