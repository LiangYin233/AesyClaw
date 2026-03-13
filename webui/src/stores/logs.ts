import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet, apiPost } from '../utils/apiClient'
import type { LoggingConfig, ObservabilityLogEntry, LoggingEntriesResponse } from '../types/api'

type LogFilterLevel = 'all' | 'debug' | 'info' | 'warn' | 'error'

export const useLogsStore = defineStore('logs', () => {
  const config = ref<LoggingConfig | null>(null)
  const entries = ref<ObservabilityLogEntry[]>([])
  const loading = ref(false)
  const entriesLoading = ref(false)
  const error = ref<string | null>(null)
  const lastUpdate = ref<number>(0)
  const activeLevel = ref<LogFilterLevel>('all')

  let pollInterval: number | null = null
  let visibilityHandler: (() => void) | null = null

  async function fetchConfig() {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<LoggingConfig>('/observability/logging/config')
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

  async function fetchEntries(level: LogFilterLevel = activeLevel.value, limit: number = 200) {
    entriesLoading.value = true
    error.value = null

    try {
      activeLevel.value = level
      const params = new URLSearchParams({ limit: String(limit) })

      if (level !== 'all') {
        params.set('level', level)
      }

      const { data, error: err } = await apiGet<LoggingEntriesResponse>(`/observability/logging/entries?${params.toString()}`)
      if (err) {
        error.value = err
        return false
      }

      entries.value = data?.entries || []
      lastUpdate.value = Date.now()
      return true
    } finally {
      entriesLoading.value = false
    }
  }

  async function setLogLevel(level: string) {
    const { error: err } = await apiPost('/observability/logging/level', { level })
    if (err) {
      error.value = err
      return false
    }
    if (config.value) {
      config.value.level = level
    }
    return true
  }

  function startPolling(intervalMs: number = 3000) {
    stopPolling()

    const refresh = () => {
      void fetchEntries(activeLevel.value)
    }

    visibilityHandler = () => {
      if (document.hidden) {
        if (pollInterval) {
          clearInterval(pollInterval)
          pollInterval = null
        }
        return
      }

      refresh()
      if (!pollInterval) {
        pollInterval = window.setInterval(refresh, intervalMs)
      }
    }

    document.addEventListener('visibilitychange', visibilityHandler)

    if (!document.hidden) {
      refresh()
      pollInterval = window.setInterval(refresh, intervalMs)
    }
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }

    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
  }

  return {
    config,
    entries,
    loading,
    entriesLoading,
    error,
    lastUpdate,
    activeLevel,
    fetchConfig,
    fetchEntries,
    setLogLevel,
    startPolling,
    stopPolling
  }
})
