import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet, apiPut } from '../utils/apiClient'
import type { Config } from '../types/api'

export const useConfigStore = defineStore('config', () => {
  const config = ref<Config | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const isDirty = ref(false)

  async function fetchConfig() {
    loading.value = true
    error.value = null

    const { data, error: err } = await apiGet<Config>('/config')

    if (err) {
      error.value = err
      loading.value = false
      return false
    }

    config.value = data
    isDirty.value = false
    loading.value = false
    return true
  }

  async function saveConfig() {
    if (!config.value) return false

    loading.value = true
    error.value = null

    const { error: err } = await apiPut('/config', config.value)

    if (err) {
      error.value = err
      loading.value = false
      return false
    }

    await fetchConfig()
    isDirty.value = false
    loading.value = false
    return true
  }

  function updateConfig(updates: Partial<Config>) {
    if (config.value) {
      config.value = { ...config.value, ...updates }
      isDirty.value = true
    }
  }

  function resetConfig() {
    fetchConfig()
    isDirty.value = false
  }

  return {
    config,
    loading,
    error,
    isDirty,
    fetchConfig,
    saveConfig,
    updateConfig,
    resetConfig
  }
})
