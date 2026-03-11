import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet } from '../utils/apiClient'
import type { Tool } from '../types/api'

export const useToolsStore = defineStore('tools', () => {
  const tools = ref<Tool[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchTools() {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<{ tools: Tool[] }>('/tools')
      if (err) {
        error.value = err
        tools.value = []
        return []
      }
      tools.value = data?.tools || []
      return tools.value
    } finally {
      loading.value = false
    }
  }

  return { tools, loading, error, fetchTools }
})
