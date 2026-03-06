// UI store - manages UI state (toasts, modals, sidebar, etc.)
import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ToastMessage {
  id: string
  severity: 'success' | 'info' | 'warn' | 'error'
  summary: string
  detail?: string
  life?: number
}

export const useUiStore = defineStore('ui', () => {
  // State
  const sidebarOpen = ref(true)
  const toasts = ref<ToastMessage[]>([])
  const isMobile = ref(false)

  // Actions
  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }

  function openSidebar() {
    sidebarOpen.value = true
  }

  function closeSidebar() {
    sidebarOpen.value = false
  }

  function showToast(toast: Omit<ToastMessage, 'id'>) {
    const id = `toast-${Date.now()}-${Math.random()}`
    const newToast: ToastMessage = {
      id,
      ...toast,
      life: toast.life ?? (toast.severity === 'error' ? 0 : 3000) // Errors don't auto-dismiss
    }

    toasts.value.push(newToast)

    // Auto-remove if life is set
    if (newToast.life && newToast.life > 0) {
      setTimeout(() => {
        removeToast(id)
      }, newToast.life)
    }

    return id
  }

  function removeToast(id: string) {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  function clearToasts() {
    toasts.value = []
  }

  // Convenience methods for different toast types
  function success(summary: string, detail?: string) {
    return showToast({ severity: 'success', summary, detail })
  }

  function info(summary: string, detail?: string) {
    return showToast({ severity: 'info', summary, detail })
  }

  function warn(summary: string, detail?: string) {
    return showToast({ severity: 'warn', summary, detail })
  }

  function error(summary: string, detail?: string) {
    return showToast({ severity: 'error', summary, detail, life: 0 })
  }

  function setMobile(mobile: boolean) {
    isMobile.value = mobile
  }

  return {
    // State
    sidebarOpen,
    toasts,
    isMobile,

    // Actions
    toggleSidebar,
    openSidebar,
    closeSidebar,
    showToast,
    removeToast,
    clearToasts,
    success,
    info,
    warn,
    error,
    setMobile
  }
})
