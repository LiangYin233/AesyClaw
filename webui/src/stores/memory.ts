import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet, apiDelete } from '../utils/apiClient'
import type { MemoryEntry } from '../types/api'
import { withRequestState } from '../utils/requestState'

export const useMemoryStore = defineStore('memory', () => {
  const entries = ref<MemoryEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchEntries() {
    return withRequestState(loading, error, async () => {
      const { data, error: err } = await apiGet<{ items: MemoryEntry[] }>('/memory')
      if (err) {
        error.value = err
        entries.value = []
        return []
      }
      entries.value = data?.items || []
      return entries.value
    })
  }

  async function deleteEntry(key: string) {
    return withRequestState(loading, error, async () => {
      const { error: err } = await apiDelete(`/memory/${encodeURIComponent(key)}`)
      if (err) {
        error.value = err
        return false
      }
      entries.value = entries.value.filter((entry) => entry.key !== key)
      return true
    })
  }

  async function clearAll() {
    return withRequestState(loading, error, async () => {
      const { error: err } = await apiDelete('/memory')
      if (err) {
        error.value = err
        return false
      }
      entries.value = []
      return true
    })
  }

  return { entries, loading, error, fetchEntries, deleteEntry, clearAll }
})
