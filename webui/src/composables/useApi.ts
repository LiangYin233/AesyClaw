import { ref } from 'vue'

const API_BASE = '/api'

export interface Status {
    version: string
    uptime: number
    channels: any
    sessions: number
    agentRunning: boolean
}

export interface Session {
    key: string
    channel?: string
    chatId?: string
    uuid?: string
    messageCount: number
    messages?: any[]
}

export interface Tool {
    name: string
    description: string
    parameters: any
}

export interface Config {
    server: {
        host: string
        port: number
        apiPort: number
        webuiPort?: number
    }
    agent: {
        defaults: {
            model: string
            provider: string
            maxTokens: number
            maxToolIterations: number
            memoryWindow: number
        }
    }
    channels: Record<string, any>
    providers: Record<string, any>
    mcp?: any
}

export interface CronJob {
    id: string
    name: string
    enabled: boolean
    schedule: {
        kind: 'once' | 'interval' | 'daily' | 'cron'
        onceAt?: string
        intervalMs?: number
        dailyAt?: string
        cronExpr?: string
    }
    payload: {
        description: string
        detail: string
        channel?: string
        target?: string
    }
    nextRunAtMs?: number
    lastRunAtMs?: number
}

export interface PluginInfo {
    name: string
    version: string
    description?: string
    author?: string
    enabled: boolean
    options?: Record<string, any>
    defaultConfig?: Record<string, any>
    toolsCount: number
}

export function useApi() {
    const loading = ref(false)
    const error = ref<string | null>(null)

    async function getStatus(): Promise<Status | null> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/status`)
            return await res.json()
        } catch (e: any) {
            error.value = e.message
            return null
        } finally {
            loading.value = false
        }
    }

    async function getSessions(): Promise<Session[]> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/sessions`)
            const data = await res.json()
            return data.sessions || []
        } catch (e: any) {
            error.value = e.message
            return []
        } finally {
            loading.value = false
        }
    }

    async function getSession(key: string): Promise<Session | null> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/sessions/${key}`)
            return await res.json()
        } catch (e: any) {
            error.value = e.message
            return null
        } finally {
            loading.value = false
        }
    }

    async function deleteSession(key: string): Promise<boolean> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/sessions/${key}`, { method: 'DELETE' })
            return res.ok
        } catch (e: any) {
            error.value = e.message
            return false
        } finally {
            loading.value = false
        }
    }

    async function sendMessage(sessionKey: string, message: string): Promise<string | null> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionKey, message })
            })
            const data = await res.json()
            if (data.success) {
                return data.response
            }
            throw new Error(data.error)
        } catch (e: any) {
            error.value = e.message
            return null
        } finally {
            loading.value = false
        }
    }

    async function getTools(): Promise<Tool[]> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/tools`)
            const data = await res.json()
            return data.tools || []
        } catch (e: any) {
            error.value = e.message
            return []
        } finally {
            loading.value = false
        }
    }

    async function getConfig(): Promise<Config | null> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/config`)
            return await res.json()
        } catch (e: any) {
            error.value = e.message
            return null
        } finally {
            loading.value = false
        }
    }

    async function saveConfig(config: Config): Promise<boolean> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            })
            return res.ok
        } catch (e: any) {
            error.value = e.message
            return false
        } finally {
            loading.value = false
        }
    }

    async function getChannels(): Promise<any> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/channels`)
            return await res.json()
        } catch (e: any) {
            error.value = e.message
            return null
        } finally {
            loading.value = false
        }
    }

    async function getPlugins(): Promise<PluginInfo[]> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/plugins`)
            const data = await res.json()
            return data.plugins || []
        } catch (e: any) {
            error.value = e.message
            return []
        } finally {
            loading.value = false
        }
    }

    async function togglePlugin(name: string, enabled: boolean): Promise<boolean> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/plugins/${name}/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            })
            return res.ok
        } catch (e: any) {
            error.value = e.message
            return false
        } finally {
            loading.value = false
        }
    }

    async function updatePluginConfig(name: string, options: Record<string, any>): Promise<boolean> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/plugins/${name}/config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ options })
            })
            return res.ok
        } catch (e: any) {
            error.value = e.message
            return false
        } finally {
            loading.value = false
        }
    }

    async function getCronJobs(): Promise<CronJob[]> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/cron`)
            const data = await res.json()
            return data.jobs || []
        } catch (e: any) {
            error.value = e.message
            return []
        } finally {
            loading.value = false
        }
    }

    async function getCronJob(id: string): Promise<CronJob | null> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/cron/${id}`)
            const data = await res.json()
            return data.job || null
        } catch (e: any) {
            error.value = e.message
            return null
        } finally {
            loading.value = false
        }
    }

    async function createCronJob(job: Partial<CronJob>): Promise<CronJob | null> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/cron`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(job)
            })
            const data = await res.json()
            if (data.success) {
                return data.job
            }
            throw new Error(data.error)
        } catch (e: any) {
            error.value = e.message
            return null
        } finally {
            loading.value = false
        }
    }

    async function updateCronJob(id: string, job: Partial<CronJob>): Promise<boolean> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/cron/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(job)
            })
            return res.ok
        } catch (e: any) {
            error.value = e.message
            return false
        } finally {
            loading.value = false
        }
    }

    async function deleteCronJob(id: string): Promise<boolean> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/cron/${id}`, { method: 'DELETE' })
            return res.ok
        } catch (e: any) {
            error.value = e.message
            return false
        } finally {
            loading.value = false
        }
    }

    async function toggleCronJob(id: string, enabled: boolean): Promise<boolean> {
        loading.value = true
        error.value = null
        try {
            const res = await fetch(`${API_BASE}/cron/${id}/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            })
            return res.ok
        } catch (e: any) {
            error.value = e.message
            return false
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
        updatePluginConfig,
        getCronJobs,
        getCronJob,
        createCronJob,
        updateCronJob,
        deleteCronJob,
        toggleCronJob
    }
}
