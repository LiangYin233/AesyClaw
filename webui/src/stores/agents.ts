import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiDelete, apiGet, apiPost, apiPut } from '../utils/apiClient'
import type { AgentRole, AgentRoleConfig } from '../types/api'

export const useAgentsStore = defineStore('agents', () => {
  const agents = ref<AgentRole[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchAgents() {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<{ agents: AgentRole[] }>('/agents')
      if (err) {
        error.value = err
        agents.value = []
        return []
      }
      agents.value = data?.agents || []
      return agents.value
    } finally {
      loading.value = false
    }
  }

  async function createAgent(agent: AgentRoleConfig) {
    const { data, error: err } = await apiPost<{ agent: AgentRole }>('/agents', agent)
    if (err) {
      error.value = err
      return null
    }
    if (data?.agent) {
      agents.value = [...agents.value.filter(item => item.name !== data.agent.name), data.agent]
        .sort((a, b) => Number(a.builtin) - Number(b.builtin) || a.name.localeCompare(b.name))
    }
    return data?.agent || null
  }

  async function updateAgent(name: string, agent: AgentRoleConfig) {
    const { data, error: err } = await apiPut<{ agent: AgentRole }>(`/agents/${name}`, agent)
    if (err) {
      error.value = err
      return null
    }
    if (data?.agent) {
      agents.value = agents.value.map(item => item.name === name ? data.agent : item)
    }
    return data?.agent || null
  }

  async function deleteAgent(name: string) {
    const { error: err } = await apiDelete(`/agents/${name}`)
    if (err) {
      error.value = err
      return false
    }
    agents.value = agents.value.filter(item => item.name !== name)
    return true
  }

  return {
    agents,
    loading,
    error,
    fetchAgents,
    createAgent,
    updateAgent,
    deleteAgent
  }
})
