import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet, apiDelete } from '../utils/apiClient'
import type { MemoryEntry } from '../types/api'

export const useMemoryStore = defineStore('memory', () => {
  const entries = ref<MemoryEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchEntries() {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<{ items: MemoryEntry[] }>('/memory')
      if (err) {
        error.value = err
        entries.value = []
        return []
      }
      entries.value = data?.items || []
      return entries.value
    } finally {
      loading.value = false
    }
  }

  async function deleteEntry(key: string) {
    loading.value = true
    error.value = null
    try {
      const { error: err } = await apiDelete(`/memory/${encodeURIComponent(key)}`)
      if (err) {
        error.value = err
        return false
      }
      entries.value = entries.value.filter((entry) => entry.key !== key)
      return true
    } finally {
      loading.value = false
    }
  }

  async function clearAll() {
    loading.value = true
    error.value = null
    try {
      const { error: err } = await apiDelete('/memory')
      if (err) {
        error.value = err
        return false
      }
      entries.value = []
      return true
    } finally {
      loading.value = false
    }
  }

  return { entries, loading, error, fetchEntries, deleteEntry, clearAll }
})
