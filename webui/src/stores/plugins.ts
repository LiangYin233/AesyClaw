import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet, apiPost, apiPut } from '../utils/apiClient'
import type { PluginInfo } from '../types/api'
import { withRequestState } from '../utils/requestState'

export const usePluginsStore = defineStore('plugins', () => {
  const plugins = ref<PluginInfo[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
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

    const plugin = plugins.value.find(p => p.name === name)
    if (plugin) {
      plugin.options = options
    }

    return true
  }

  return {
    plugins,
    loading,
    error,
    fetchPlugins,
    togglePlugin,
    updatePluginConfig
  }
})
