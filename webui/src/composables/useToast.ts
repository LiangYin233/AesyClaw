// Unified Toast composable
import { useUiStore } from '../stores/ui'
import { announceToScreenReader } from './useA11y'

export function useToast() {
  const uiStore = useUiStore()

  function success(summary: string, detail?: string) {
    announceToScreenReader(`成功：${summary}`, 'polite')
    return uiStore.success(summary, detail)
  }

  function info(summary: string, detail?: string) {
    announceToScreenReader(`信息：${summary}`, 'polite')
    return uiStore.info(summary, detail)
  }

  function warn(summary: string, detail?: string) {
    announceToScreenReader(`警告：${summary}`, 'assertive')
    return uiStore.warn(summary, detail)
  }

  function error(summary: string, detail?: string) {
    announceToScreenReader(`错误：${summary}`, 'assertive')
    return uiStore.error(summary, detail)
  }

  function remove(id: string) {
    return uiStore.removeToast(id)
  }

  function clear() {
    return uiStore.clearToasts()
  }

  return {
    success,
    info,
    warn,
    error,
    remove,
    clear
  }
}
