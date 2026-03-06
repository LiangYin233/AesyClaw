// Cron store - manages scheduled jobs
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiClient'
import type { CronJob } from '../types/api'

export const useCronStore = defineStore('cron', () => {
  // State
  const jobs = ref<CronJob[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const enabledJobs = computed(() => jobs.value.filter(j => j.enabled))
  const disabledJobs = computed(() => jobs.value.filter(j => !j.enabled))
  const jobCount = computed(() => jobs.value.length)

  const upcomingJobs = computed(() =>
    jobs.value
      .filter(j => j.enabled && j.nextRunAtMs)
      .sort((a, b) => (a.nextRunAtMs || 0) - (b.nextRunAtMs || 0))
  )

  // Actions
  async function fetchJobs() {
    loading.value = true
    error.value = null

    const { data, error: err } = await apiGet<{ jobs: CronJob[] }>('/cron')

    if (err) {
      error.value = err
      loading.value = false
      return false
    }

    jobs.value = data?.jobs || []
    loading.value = false
    return true
  }

  async function fetchJob(id: string) {
    const { data, error: err } = await apiGet<{ job: CronJob }>(`/cron/${id}`)

    if (err) {
      error.value = err
      return null
    }

    return data?.job || null
  }

  async function createJob(job: Partial<CronJob>) {
    const { data, error: err } = await apiPost<{ success: boolean; job?: CronJob; error?: string }>(
      '/cron',
      job
    )

    if (err) {
      error.value = err
      return null
    }

    if (data?.success && data.job) {
      jobs.value.push(data.job)
      return data.job
    }

    error.value = data?.error || 'Unknown error'
    return null
  }

  async function updateJob(id: string, job: Partial<CronJob>) {
    const { error: err } = await apiPut(`/cron/${id}`, job)

    if (err) {
      error.value = err
      return false
    }

    // Update local state
    const index = jobs.value.findIndex(j => j.id === id)
    if (index !== -1) {
      jobs.value[index] = { ...jobs.value[index], ...job }
    }

    return true
  }

  async function deleteJob(id: string) {
    const { error: err } = await apiDelete(`/cron/${id}`)

    if (err) {
      error.value = err
      return false
    }

    // Remove from local state
    jobs.value = jobs.value.filter(j => j.id !== id)
    return true
  }

  async function toggleJob(id: string, enabled: boolean) {
    const { error: err } = await apiPost(`/cron/${id}/toggle`, { enabled })

    if (err) {
      error.value = err
      return false
    }

    // Update local state
    const job = jobs.value.find(j => j.id === id)
    if (job) {
      job.enabled = enabled
    }

    return true
  }

  function clearError() {
    error.value = null
  }

  return {
    // State
    jobs,
    loading,
    error,

    // Getters
    enabledJobs,
    disabledJobs,
    jobCount,
    upcomingJobs,

    // Actions
    fetchJobs,
    fetchJob,
    createJob,
    updateJob,
    deleteJob,
    toggleJob,
    clearError
  }
})
