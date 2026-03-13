import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiGet, apiPost } from '../utils/apiClient'
import type { MetricOverview, MetricStats, MemoryUsage } from '../types/api'

type MetricDetails = MetricStats & { name: string }

export const useMetricsStore = defineStore('metrics', () => {
  const overview = ref<MetricOverview | null>(null)
  const memoryUsage = ref<MemoryUsage | null>(null)
  const metricNames = ref<string[]>([])
  const selectedMetric = ref<MetricDetails | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const filteredMetricNames = computed(() => (query: string) => {
    if (!query) return metricNames.value
    const normalized = query.toLowerCase()
    return metricNames.value.filter((name) => name.toLowerCase().includes(normalized))
  })

  async function fetchOverview() {
    const { data, error: err } = await apiGet<MetricOverview>('/metrics/overview')
    if (err) {
      error.value = err
      return null
    }
    overview.value = data
    return data
  }

  async function fetchMemoryUsage() {
    const { data, error: err } = await apiGet<MemoryUsage>('/metrics/memory')
    if (err) {
      error.value = err
      return null
    }
    memoryUsage.value = data
    return data
  }

  async function fetchMetricNames() {
    const { data, error: err } = await apiGet<{ names: string[] }>('/metrics/names')
    if (err) {
      error.value = err
      return []
    }
    metricNames.value = data?.names || []
    return metricNames.value
  }

  async function fetchMetricStats(name: string, options?: { updateSelection?: boolean }) {
    const { data, error: err } = await apiGet<MetricStats>(`/metrics/stats/${name}`)
    if (err) {
      error.value = err
      return null
    }
    if (options?.updateSelection) {
      selectedMetric.value = data ? { ...data, name } : null
    }
    return data
  }

  async function exportMetrics() {
    const { data, error: err } = await apiGet<Record<string, any>>('/metrics/export')
    if (err) {
      error.value = err
      return null
    }
    return data
  }

  async function clearMetrics() {
    const { error: err } = await apiPost('/metrics/clear')
    if (err) {
      error.value = err
      return false
    }
    overview.value = null
    memoryUsage.value = null
    metricNames.value = []
    selectedMetric.value = null
    return true
  }

  async function refreshAll() {
    loading.value = true
    error.value = null
    try {
      const [overviewResult, memoryResult, namesResult] = await Promise.all([
        fetchOverview(),
        fetchMemoryUsage(),
        fetchMetricNames()
      ])
      return { overview: overviewResult, memory: memoryResult, names: namesResult }
    } finally {
      loading.value = false
    }
  }

  return {
    overview,
    memoryUsage,
    metricNames,
    selectedMetric,
    loading,
    error,
    filteredMetricNames,
    fetchOverview,
    fetchMemoryUsage,
    fetchMetricNames,
    fetchMetricStats,
    exportMetrics,
    clearMetrics,
    refreshAll
  }
})
