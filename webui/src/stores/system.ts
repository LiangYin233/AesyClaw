// System store - manages system status and channels
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiGet } from '../utils/apiClient'
import type { Status } from '../types/api'

export const useSystemStore = defineStore('system', () => {
  // State
  const status = ref<Status | null>(null)
  const channels = ref<any>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const lastUpdate = ref<number>(0)

  // Getters
  const agentRunning = computed(() => status.value?.agentRunning ?? false)
  const version = computed(() => status.value?.version ?? 'Unknown')
  const uptime = computed(() => status.value?.uptime ?? 0)
  const sessionCount = computed(() => status.value?.sessions ?? 0)

  // Actions
  async function fetchStatus() {
    loading.value = true
    error.value = null

    const { data, error: err } = await apiGet<Status>('/status')

    if (err) {
      error.value = err
      loading.value = false
      return false
    }

    status.value = data
    lastUpdate.value = Date.now()
    loading.value = false
    return true
  }

  async function fetchChannels() {
    const { data, error: err } = await apiGet<any>('/channels')

    if (err) {
      error.value = err
      return false
    }

    channels.value = data
    return true
  }

  async function refresh() {
    await Promise.all([fetchStatus(), fetchChannels()])
  }

  // Polling management
  let pollInterval: number | null = null
  let isPageVisible = true

  function startPolling(intervalMs: number = 5000) {
    stopPolling()

    // Use Page Visibility API to pause polling when page is hidden
    const handleVisibilityChange = () => {
      isPageVisible = !document.hidden

      if (isPageVisible && !pollInterval) {
        // Resume polling when page becomes visible
        pollInterval = window.setInterval(fetchStatus, intervalMs)
        fetchStatus() // Immediate fetch
      } else if (!isPageVisible && pollInterval) {
        // Pause polling when page is hidden
        stopPolling()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Start initial polling
    if (isPageVisible) {
      pollInterval = window.setInterval(fetchStatus, intervalMs)
      fetchStatus()
    }
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }
  }

  return {
    // State
    status,
    channels,
    loading,
    error,
    lastUpdate,

    // Getters
    agentRunning,
    version,
    uptime,
    sessionCount,

    // Actions
    fetchStatus,
    fetchChannels,
    refresh,
    startPolling,
    stopPolling
  }
})
