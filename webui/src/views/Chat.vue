<template>
    <div class="chat-page">
        <PageHeader title="聊天" subtitle="发送消息并管理当前会话">
            <template #actions>
                <div class="chat-toolbar">
                    <label for="session-key-input" class="sr-only">会话ID</label>
                    <InputText
                        id="session-key-input"
                        v-model="sessionKey"
                        placeholder="会话ID"
                        class="session-input"
                        aria-label="会话ID"
                    />
                    <Select
                        v-model="currentAgentName"
                        :options="agentOptions"
                        option-label="label"
                        option-value="value"
                        class="agent-select"
                        placeholder="选择 Agent"
                        @change="handleAgentChange"
                    />
                    <Button icon="pi pi-refresh" text @click="loadSession" aria-label="刷新并加载会话" title="加载会话" />
                    <Button icon="pi pi-plus" label="新建会话" severity="secondary" @click="createNewSession" aria-label="创建新会话" />
                </div>
            </template>
        </PageHeader>

        <div
            ref="messagesContainer"
            class="chat-messages"
            role="log"
            aria-live="polite"
            aria-atomic="false"
            aria-relevant="additions"
        >
            <div v-if="messages.length === 0" class="empty-state" role="status">
                <i class="pi pi-comments" aria-hidden="true"></i>
                <span>开始一段对话吧</span>
            </div>

            <div
                v-for="(msg, index) in messages"
                :key="index"
                class="message-wrapper"
                :class="msg.role"
                role="article"
                :aria-label="`${msg.role === 'user' ? '用户' : 'AI 助手'}消息`"
            >
                <div class="message-avatar" :aria-label="msg.role === 'user' ? '用户头像' : 'AI 助手头像'">
                    <i :class="msg.role === 'user' ? 'pi pi-user' : 'pi pi-robot'" aria-hidden="true"></i>
                </div>
                <Card class="message-card">
                    <template #content>
                        <p class="message-content">{{ msg.content }}</p>
                    </template>
                </Card>
            </div>

            <div v-if="loading" class="loading-indicator" role="status" aria-live="polite">
                <ProgressSpinner style="width: 32px; height: 32px" aria-label="正在思考" />
                <span>正在思考...</span>
            </div>
        </div>

        <div class="chat-input" role="region" aria-label="消息输入区">
            <form @submit.prevent="sendMessage" class="input-form">
                <label for="message-input" class="sr-only">输入消息</label>
                <InputText
                    id="message-input"
                    v-model="inputMessage"
                    placeholder="输入消息... (Ctrl+Enter 发送)"
                    class="message-input"
                    :disabled="loading"
                    aria-label="消息输入框"
                    :aria-invalid="!inputMessage.trim() && inputMessage.length > 0"
                />
                <Button
                    icon="pi pi-send"
                    type="submit"
                    :loading="loading"
                    :disabled="!inputMessage.trim() || loading"
                    aria-label="发送消息"
                    title="发送消息 (Ctrl+Enter)"
                />
            </form>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useAgentsStore, useSessionsStore } from '../stores'
import { useKeyboard } from '../composables/useKeyboard'
import { announceToScreenReader } from '../composables/useA11y'
import { useToast } from '../composables/useToast'
import PageHeader from '../components/common/PageHeader.vue'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Card from 'primevue/card'
import ProgressSpinner from 'primevue/progressspinner'
import Select from 'primevue/select'

const route = useRoute()
const sessionsStore = useSessionsStore()
const agentsStore = useAgentsStore()
const toast = useToast()

const sessionKey = ref(`chat:${Date.now()}`)
const inputMessage = ref('')
const loading = ref(false)
const messages = ref<{ role: string; content: string }[]>([])
const messagesContainer = ref<HTMLElement | null>(null)
const currentAgentName = ref('main')
const applyingAgent = ref(false)

const agentOptions = computed(() => {
    return agentsStore.agents.map(agent => ({
        label: agent.builtin ? `${agent.name}（内建）` : agent.name,
        value: agent.name
    }))
})

async function ensureAgentsLoaded() {
    if (agentsStore.agents.length === 0) {
        await agentsStore.fetchAgents()
    }
}

async function loadSession() {
    if (!sessionKey.value) return

    await ensureAgentsLoaded()
    announceToScreenReader('正在加载会话', 'polite')

    const session = await sessionsStore.fetchSession(sessionKey.value)
    if (session?.messages) {
        messages.value = session.messages
        currentAgentName.value = session.agentName || 'main'
        scrollToBottom()
        announceToScreenReader(`已加载 ${session.messages.length} 条消息`, 'polite')
    } else {
        messages.value = []
        currentAgentName.value = 'main'
        announceToScreenReader('会话加载失败或为空', 'polite')
    }
}

async function handleAgentChange() {
    if (!sessionKey.value || applyingAgent.value) {
        return
    }

    applyingAgent.value = true
    const nextAgent = await sessionsStore.setSessionAgent(
        sessionKey.value,
        currentAgentName.value === 'main' ? null : currentAgentName.value
    )
    applyingAgent.value = false

    if (!nextAgent) {
        currentAgentName.value = sessionsStore.currentSession?.agentName || 'main'
        toast.error('切换失败', sessionsStore.error || '无法切换当前会话 Agent')
        return
    }

    currentAgentName.value = nextAgent
    toast.success('切换成功', `当前会话 Agent 已切换为 ${nextAgent}`)
}

async function sendMessage() {
    if (!inputMessage.value.trim() || loading.value) return

    const userMessage = inputMessage.value.trim()
    inputMessage.value = ''

    messages.value.push({ role: 'user', content: userMessage })
    loading.value = true
    scrollToBottom()

    announceToScreenReader('消息已发送，等待回复', 'polite')

    const response = await sessionsStore.sendMessage(sessionKey.value, userMessage)

    if (response) {
        messages.value.push({ role: 'assistant', content: response })
        announceToScreenReader('收到 AI 回复', 'polite')
    } else {
        messages.value.push({ role: 'assistant', content: '抱歉，发生了错误。' })
        announceToScreenReader('消息发送失败', 'assertive')
    }

    loading.value = false
    scrollToBottom()
}

function createNewSession() {
    sessionKey.value = `chat:${Date.now()}`
    messages.value = []
    currentAgentName.value = 'main'
    announceToScreenReader('已创建新会话', 'polite')
}

function scrollToBottom() {
    nextTick(() => {
        if (messagesContainer.value) {
            messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
        }
    })
}

useKeyboard([
    {
        key: 'Enter',
        ctrl: true,
        handler: () => {
            if (!loading.value && inputMessage.value.trim()) {
                sendMessage()
            }
        },
        description: '发送消息'
    },
    {
        key: 'Escape',
        handler: () => {
            inputMessage.value = ''
            announceToScreenReader('输入已清空', 'polite')
        },
        description: '清空输入'
    }
])

watch(() => route.params.sessionKey, (newKey) => {
    if (newKey) {
        sessionKey.value = newKey as string
        loadSession()
    }
}, { immediate: true })

onMounted(async () => {
    await ensureAgentsLoaded()
    if (route.params.sessionKey) {
        sessionKey.value = route.params.sessionKey as string
        loadSession()
    }
})
</script>

<style scoped>
.chat-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 100%;
}

.chat-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    width: 100%;
}

.session-input,
.agent-select {
    width: 220px;
}

.chat-messages {
    flex: 1;
    min-height: 420px;
    overflow-y: auto;
    padding: 16px;
    background: rgba(248, 250, 252, 0.9);
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #94a3b8;
    gap: 8px;
}

.empty-state i {
    font-size: 48px;
}

.message-wrapper {
    display: flex;
    gap: 12px;
    align-items: flex-start;
}

.message-wrapper.user {
    flex-direction: row-reverse;
}

.message-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: #dbeafe;
    color: #1d4ed8;
}

.message-card {
    width: fit-content;
    max-width: min(80%, 880px);
}

.message-card :deep(.p-card-body) {
    padding: 0;
}

.message-card :deep(.p-card-content) {
    padding: 14px 16px;
}

.message-content {
    margin: 0;
    line-height: 1.65;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.loading-indicator {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #64748b;
}

.chat-input {
    padding: 16px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
}

.input-form {
    display: flex;
    gap: 12px;
    align-items: center;
}

.message-input {
    flex: 1;
    min-width: 0;
}

@media (max-width: 768px) {
    .chat-page {
        gap: 14px;
    }

    .chat-toolbar {
        align-items: stretch;
    }

    .session-input,
    .agent-select {
        width: 100%;
    }

    .chat-messages {
        min-height: 320px;
        padding: 14px;
    }

    .message-card {
        max-width: calc(100% - 52px);
    }

    .input-form {
        flex-direction: column;
        align-items: stretch;
    }

    .input-form :deep(.p-button) {
        width: 100%;
        justify-content: center;
    }
}

@media (max-width: 640px) {
    .chat-messages {
        padding: 12px;
        border-radius: 14px;
    }

    .message-wrapper {
        gap: 8px;
    }

    .message-avatar {
        width: 34px;
        height: 34px;
    }

    .message-card {
        max-width: calc(100% - 42px);
    }

    .chat-input {
        padding: 12px;
    }
}
</style>
