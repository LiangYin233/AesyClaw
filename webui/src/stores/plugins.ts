// Plugins store - manages plugin state
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiGet, apiPost, apiPut } from '../utils/apiClient'
import type { PluginInfo } from '../types/api'
import { withRequestState } from '../utils/requestState'

export const usePluginsStore = defineStore('plugins', () => {
  // State
  const plugins = ref<PluginInfo[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const enabledPlugins = computed(() => plugins.value.filter(p => p.enabled))
  const disabledPlugins = computed(() => plugins.value.filter(p => !p.enabled))
  const pluginCount = computed(() => plugins.value.length)
  const totalToolsCount = computed(() =>
    plugins.value.reduce((sum, p) => sum + p.toolsCount, 0)
  )

  // Actions
  async function fetchPlugins() {
    return withRequestState(loading, error, async () => {
      const { data, error: err } = await apiGet<{ plugins: PluginInfo[] }>('/plugins')
      if (err) {
        error.value = err
        return false
      }
      plugins.value = data?.plugins || []
      return true
    })
  }

  async function togglePlugin(name: string, enabled: boolean) {
    const { error: err } = await apiPost(`/plugins/${name}/toggle`, { enabled })

    if (err) {
      error.value = err
      return false
    }

    // Update local state
    const plugin = plugins.value.find(p => p.name === name)
    if (plugin) {
      plugin.enabled = enabled
    }

    return true
  }

  async function updatePluginConfig(name: string, options: Record<string, any>) {
    const { error: err } = await apiPut(`/plugins/${name}/config`, { options })

    if (err) {
      error.value = err
      return false
    }

    // Update local state
    const plugin = plugins.value.find(p => p.name === name)
    if (plugin) {
      plugin.options = options
    }

    return true
  }

  function clearError() {
    error.value = null
  }

  return {
    // State
    plugins,
    loading,
    error,

    // Getters
    enabledPlugins,
    disabledPlugins,
    pluginCount,
    totalToolsCount,

    // Actions
    fetchPlugins,
    togglePlugin,
    updatePluginConfig,
    clearError
  }
})
