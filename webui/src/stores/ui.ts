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
  const sidebarOpen = ref(true)
  const mobileSidebarOpen = ref(false)
  const toasts = ref<ToastMessage[]>([])
  const isMobile = ref(false)

  function toggleSidebar() {
    if (isMobile.value) {
      mobileSidebarOpen.value = !mobileSidebarOpen.value
      return
    }

    sidebarOpen.value = !sidebarOpen.value
  }

  function openSidebar() {
    if (isMobile.value) {
      mobileSidebarOpen.value = true
      return
    }

    sidebarOpen.value = true
  }

  function closeSidebar() {
    if (isMobile.value) {
      mobileSidebarOpen.value = false
      return
    }

    sidebarOpen.value = false
  }

  function toggleMobileSidebar() {
    mobileSidebarOpen.value = !mobileSidebarOpen.value
  }

  function openMobileSidebar() {
    mobileSidebarOpen.value = true
  }

  function closeMobileSidebar() {
    mobileSidebarOpen.value = false
  }

  function showToast(toast: Omit<ToastMessage, 'id'>) {
    const id = `toast-${Date.now()}-${Math.random()}`
    const newToast: ToastMessage = {
      id,
      ...toast,
      life: toast.life ?? (toast.severity === 'error' ? 0 : 3000)
    }

    toasts.value.push(newToast)

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
    if (!mobile) {
      mobileSidebarOpen.value = false
    }
  }

  return {
    sidebarOpen,
    mobileSidebarOpen,
    toasts,
    isMobile,
    toggleSidebar,
    openSidebar,
    closeSidebar,
    toggleMobileSidebar,
    openMobileSidebar,
    closeMobileSidebar,
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
