import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet, apiDelete } from '../utils/apiClient'
import type { MemoryEntry, MemoryOperation } from '../types/api'
import { withRequestState } from '../utils/requestState'

export const useMemoryStore = defineStore('memory', () => {
  const entries = ref<MemoryEntry[]>([])
  const histories = ref<Record<string, MemoryOperation[]>>({})
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
      const nextHistories = { ...histories.value }
      delete nextHistories[key]
      histories.value = nextHistories
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
      histories.value = {}
      return true
    })
  }

  async function fetchHistory(key: string) {
    return withRequestState(loading, error, async () => {
      const { data, error: err } = await apiGet<{ items: MemoryOperation[] }>(`/memory/${encodeURIComponent(key)}/history`)
      if (err) {
        error.value = err
        return []
      }
      const items = data?.items || []
      histories.value = {
        ...histories.value,
        [key]: items
      }
      return items
    })
  }

  return { entries, histories, loading, error, fetchEntries, fetchHistory, deleteEntry, clearAll }
})
