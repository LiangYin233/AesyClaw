import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

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
  const theme = ref<'light' | 'dark'>('light')
  const themeReady = ref(false)

  const isDark = computed(() => theme.value === 'dark')

  function applyTheme(nextTheme: 'light' | 'dark') {
    theme.value = nextTheme
    document.documentElement.dataset.theme = nextTheme
    window.localStorage.setItem('aesyclaw-webui-theme', nextTheme)
  }

  function initializeTheme() {
    if (typeof window === 'undefined') {
      return
    }

    const storedTheme = window.localStorage.getItem('aesyclaw-webui-theme')
    if (storedTheme === 'light' || storedTheme === 'dark') {
      applyTheme(storedTheme)
    } else {
      applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    }

    themeReady.value = true
  }

  function toggleTheme() {
    applyTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

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
    theme,
    themeReady,
    isDark,
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
    setMobile,
    applyTheme,
    initializeTheme,
    toggleTheme
  }
})
