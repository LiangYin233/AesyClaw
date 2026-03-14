import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet, apiPost, apiDelete } from '../utils/apiClient'
import type { MCPServerConfig, MCPServerInfo, MCPTool } from '../types/api'
import { withRequestState } from '../utils/requestState'

export const useMcpStore = defineStore('mcp', () => {
  const servers = ref<MCPServerInfo[]>([])
  const selectedServer = ref<MCPServerInfo | null>(null)
  const serverTools = ref<MCPTool[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchServers() {
    return withRequestState(loading, error, async () => {
      const { data, error: err } = await apiGet<{ servers: MCPServerInfo[] }>('/mcp/servers')
      if (err) {
        error.value = err
        servers.value = []
        return []
      }
      servers.value = data?.servers || []
      return servers.value
    })
  }

  async function fetchServer(name: string) {
    const { data, error: err } = await apiGet<{ server: MCPServerInfo; tools: MCPTool[] }>(`/mcp/servers/${name}`)
    if (err) {
      error.value = err
      return null
    }
    selectedServer.value = data?.server || null
    serverTools.value = data?.tools || []
    return data || null
  }

  async function addServer(name: string, config: MCPServerConfig) {
    const { error: err } = await apiPost(`/mcp/servers/${name}`, config)
    if (err) {
      error.value = err
      return false
    }
    return true
  }

  async function deleteServer(name: string) {
    const { error: err } = await apiDelete(`/mcp/servers/${name}`)
    if (err) {
      error.value = err
      return false
    }
    servers.value = servers.value.filter((server) => server.name !== name)
    return true
  }

  async function reconnectServer(name: string) {
    const { error: err } = await apiPost(`/mcp/servers/${name}/reconnect`)
    if (err) {
      error.value = err
      return false
    }
    return true
  }

  async function toggleServer(name: string, enabled: boolean) {
    const { error: err } = await apiPost(`/mcp/servers/${name}/toggle`, { enabled })
    if (err) {
      error.value = err
      return false
    }
    const server = servers.value.find((item) => item.name === name)
    if (server) {
      server.config.enabled = enabled
    }
    return true
  }

  return {
    servers,
    selectedServer,
    serverTools,
    loading,
    error,
    fetchServers,
    fetchServer,
    addServer,
    deleteServer,
    reconnectServer,
    toggleServer
  }
})
