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
            temperature: number
            maxToolIterations: number
            memoryWindow: number
        }
    }
    channels: Record<string, any>
    providers: Record<string, any>
    mcp?: any
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
        getChannels
    }
}
