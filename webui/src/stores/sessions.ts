import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiGet, apiDelete, apiPost, apiPut } from '../utils/apiClient'
import type { BatchDeleteResult, Session } from '../types/api'

export const useSessionsStore = defineStore('sessions', () => {
  const sessions = ref<Session[]>([])
  const currentSession = ref<Session | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const sessionCount = computed(() => sessions.value.length)
  const sortedSessions = computed(() =>
    [...sessions.value].sort((a, b) => b.messageCount - a.messageCount)
  )

  async function fetchSessions() {
    loading.value = true
    error.value = null

    const { data, error: err } = await apiGet<{ sessions: Session[] }>('/sessions')

    if (err) {
      error.value = err
      loading.value = false
      return false
    }

    sessions.value = data?.sessions || []
    loading.value = false
    return true
  }

  async function fetchSession(key: string) {
    loading.value = true
    error.value = null

    const { data, error: err } = await apiGet<Session>(`/sessions/${key}`)

    if (err) {
      error.value = err
      loading.value = false
      return null
    }

    currentSession.value = data
    loading.value = false
    return data
  }

  async function setSessionAgent(key: string, agentName: string | null) {
    error.value = null

    const { data, error: err } = await apiPut<{ success: boolean; agentName: string }>(`/sessions/${key}/agent`, { agentName })
    if (err) {
      error.value = err
      return null
    }

    const nextAgentName = data?.agentName || 'main'
    sessions.value = sessions.value.map(session => session.key === key ? { ...session, agentName: nextAgentName } : session)
    if (currentSession.value?.key === key) {
      currentSession.value = {
        ...currentSession.value,
        agentName: nextAgentName
      }
    }

    return nextAgentName
  }

  async function deleteSession(key: string) {
    error.value = null

    const { error: err } = await apiDelete(`/sessions/${key}`)

    if (err) {
      error.value = err
      return false
    }

    sessions.value = sessions.value.filter(s => s.key !== key)

    if (currentSession.value?.key === key) {
      currentSession.value = null
    }

    error.value = null
    return true
  }

  async function deleteSessions(keys: string[]): Promise<BatchDeleteResult> {
    error.value = null

    const uniqueKeys = [...new Set(keys)]
    const result: BatchDeleteResult = {
      successKeys: [],
      failed: []
    }

    for (const key of uniqueKeys) {
      const success = await deleteSession(key)

      if (success) {
        result.successKeys.push(key)
        continue
      }

      result.failed.push({
        key,
        error: error.value || '无法删除会话'
      })
    }

    error.value = result.failed.length > 0 ? result.failed[0].error : null
    return result
  }

  async function sendMessage(sessionKey: string, message: string) {
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
  }

  return {
    sessions,
    currentSession,
    loading,
    error,
    sessionCount,
    sortedSessions,
    fetchSessions,
    fetchSession,
    setSessionAgent,
    deleteSession,
    deleteSessions,
    sendMessage
  }
})
