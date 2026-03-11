import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet, apiPost } from '../utils/apiClient'
import type { LogConfig } from '../types/api'

export const useLogsStore = defineStore('logs', () => {
  const config = ref<LogConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchConfig() {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<LogConfig>('/logs/config')
      if (err) {
        error.value = err
        config.value = null
        return null
      }
      config.value = data
      return config.value
    } finally {
      loading.value = false
    }
  }

  async function setLogLevel(level: string) {
    const { error: err } = await apiPost('/logs/level', { level })
    if (err) {
      error.value = err
      return false
    }
    if (config.value) {
      config.value.level = level
    }
    return true
  }

  return { config, loading, error, fetchConfig, setLogLevel }
})
