import { ref } from 'vue'
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiClient'
import type {
  Status,
  Session,
  Tool,
  Config,
  CronJob,
  PluginInfo,
  SkillInfo
} from '../types/api'

// Re-export types for backward compatibility
export type {
  Status,
  Session,
  Tool,
  Config,
  CronJob,
  PluginInfo,
  SkillInfo
}

/**
 * Legacy API composable with shared loading/error state
 * @deprecated Use useApiClient for new code to avoid state conflicts
 */
export function useApi() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function getStatus(): Promise<Status | null> {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<Status>('/status')
      if (err) {
        error.value = err
        return null
      }
      return data
    } finally {
      loading.value = false
    }
  }

  async function getSessions(): Promise<Session[]> {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<{ sessions: Session[] }>('/sessions')
      if (err) {
        error.value = err
        return []
      }
      return data?.sessions || []
    } finally {
      loading.value = false
    }
  }

  async function getSession(key: string): Promise<Session | null> {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<Session>(`/sessions/${key}`)
      if (err) {
        error.value = err
        return null
      }
      return data
    } finally {
      loading.value = false
    }
  }

  async function deleteSession(key: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const { error: err } = await apiDelete(`/sessions/${key}`)
      if (err) {
        error.value = err
        return false
      }
      return true
    } finally {
      loading.value = false
    }
  }

  async function sendMessage(sessionKey: string, message: string): Promise<string | null> {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiPost<{ success: boolean; response?: string; error?: string }>(
        '/chat',
        { sessionKey, message }
      )
      if (err) {
        error.value = err
        return null
      }
      if (data?.success) {
        return data.response || null
      }
      error.value = data?.error || 'Unknown error'
      return null
    } finally {
      loading.value = false
    }
  }

  async function getTools(): Promise<Tool[]> {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<{ tools: Tool[] }>('/tools')
      if (err) {
        error.value = err
        return []
      }
      return data?.tools || []
    } finally {
      loading.value = false
    }
  }

  async function getConfig(): Promise<Config | null> {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<Config>('/config')
      if (err) {
        error.value = err
        return null
      }
      return data
    } finally {
      loading.value = false
    }
  }

  async function saveConfig(config: Config): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const { error: err } = await apiPut('/config', config)
      if (err) {
        error.value = err
        return false
      }
      return true
    } finally {
      loading.value = false
    }
  }

  async function getChannels(): Promise<any> {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<any>('/channels')
      if (err) {
        error.value = err
        return null
      }
      return data
    } finally {
      loading.value = false
    }
  }

  async function getPlugins(): Promise<PluginInfo[]> {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<{ plugins: PluginInfo[] }>('/plugins')
      if (err) {
        error.value = err
        return []
      }
      return data?.plugins || []
    } finally {
      loading.value = false
    }
  }

  async function togglePlugin(name: string, enabled: boolean): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const { error: err } = await apiPost(`/plugins/${name}/toggle`, { enabled })
      if (err) {
        error.value = err
        return false
      }
      return true
    } finally {
      loading.value = false
    }
  }

  async function reloadPlugin(name: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const { error: err } = await apiPost(`/plugins/${name}/reload`)
      if (err) {
        error.value = err
        return false
      }
      return true
    } finally {
      loading.value = false
    }
  }

  async function updatePluginConfig(name: string, options: Record<string, any>): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const { error: err } = await apiPut(`/plugins/${name}/config`, { options })
      if (err) {
        error.value = err
        return false
      }
      return true
    } finally {
      loading.value = false
    }
  }

  async function getCronJobs(): Promise<CronJob[]> {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<{ jobs: CronJob[] }>('/cron')
      if (err) {
        error.value = err
        return []
      }
      return data?.jobs || []
    } finally {
      loading.value = false
    }
  }

  async function getCronJob(id: string): Promise<CronJob | null> {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<{ job: CronJob }>(`/cron/${id}`)
      if (err) {
        error.value = err
        return null
      }
      return data?.job || null
    } finally {
      loading.value = false
    }
  }

  async function createCronJob(job: Partial<CronJob>): Promise<CronJob | null> {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiPost<{ success: boolean; job?: CronJob; error?: string }>(
        '/cron',
        job
      )
      if (err) {
        error.value = err
        return null
      }
      if (data?.success) {
        return data.job || null
      }
      error.value = data?.error || 'Unknown error'
      return null
    } finally {
      loading.value = false
    }
  }

  async function updateCronJob(id: string, job: Partial<CronJob>): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const { error: err } = await apiPut(`/cron/${id}`, job)
      if (err) {
        error.value = err
        return false
      }
      return true
    } finally {
      loading.value = false
    }
  }

  async function deleteCronJob(id: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const { error: err } = await apiDelete(`/cron/${id}`)
      if (err) {
        error.value = err
        return false
      }
      return true
    } finally {
      loading.value = false
    }
  }

  async function toggleCronJob(id: string, enabled: boolean): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const { error: err } = await apiPost(`/cron/${id}/toggle`, { enabled })
      if (err) {
        error.value = err
        return false
      }
      return true
    } finally {
      loading.value = false
    }
  }

  async function getSkills(): Promise<SkillInfo[]> {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<{ skills: SkillInfo[] }>('/skills')
      if (err) {
        error.value = err
        return []
      }
      return data?.skills || []
    } finally {
      loading.value = false
    }
  }

  async function toggleSkill(name: string, enabled: boolean): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const { error: err } = await apiPost(`/skills/${name}/toggle`, { enabled })
      if (err) {
        error.value = err
        return false
      }
      return true
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    error,
    getStatus,
    getSessions,
    getSession,
    deleteSession,
    sendMessage,
    getTools,
    getConfig,
    saveConfig,
    getChannels,
    getPlugins,
    togglePlugin,
    reloadPlugin,
    updatePluginConfig,
    getCronJobs,
    getCronJob,
    createCronJob,
    updateCronJob,
    deleteCronJob,
    toggleCronJob,
    getSkills,
    toggleSkill
  }
}
