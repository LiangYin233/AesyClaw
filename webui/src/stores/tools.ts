import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet } from '../utils/apiClient'
import type { Tool } from '../types/api'
import { withRequestState } from '../utils/requestState'

export const useToolsStore = defineStore('tools', () => {
  const tools = ref<Tool[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchTools() {
    return withRequestState(loading, error, async () => {
      const { data, error: err } = await apiGet<{ tools: Tool[] }>('/tools')
      if (err) {
        error.value = err
        tools.value = []
        return []
      }
      tools.value = data?.tools || []
      return tools.value
    })
  }

  return { tools, loading, error, fetchTools }
})
