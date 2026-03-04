<template>
    <div class="chat-page">
        <div class="chat-header">
            <h1>聊天</h1>
            <div class="chat-actions">
                <InputText v-model="sessionKey" placeholder="会话ID" class="session-input" />
                <Button icon="pi pi-refresh" text @click="loadSession" title="加载会话" />
                <Button icon="pi pi-plus" label="新建会话" severity="secondary" @click="createNewSession" />
            </div>
        </div>
        
        <div class="chat-messages" ref="messagesContainer">
            <div v-if="messages.length === 0" class="empty-state">
                <i class="pi pi-comments"></i>
                <span>开始一段对话吧</span>
            </div>
            
            <div v-for="(msg, index) in messages" :key="index" class="message-wrapper" :class="msg.role">
                <div class="message-avatar">
                    <i :class="msg.role === 'user' ? 'pi pi-user' : 'pi pi-robot'"></i>
                </div>
                <Card class="message-card">
                    <template #content>
                        <p class="message-content">{{ msg.content }}</p>
                    </template>
                </Card>
            </div>
            
            <div v-if="loading" class="loading-indicator">
                <ProgressSpinner style="width: 32px; height: 32px" />
                <span>正在思考...</span>
            </div>
        </div>
        
        <div class="chat-input">
            <form @submit.prevent="sendMessage" class="input-form">
                <InputText v-model="inputMessage" placeholder="输入消息..." class="message-input" :disabled="loading" />
                <Button icon="pi pi-send" type="submit" :loading="loading" :disabled="!inputMessage.trim() || loading" />
            </form>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '../composables/useApi'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Card from 'primevue/card'
import ProgressSpinner from 'primevue/progressspinner'

const route = useRoute()
const { sendMessage: sendApiMessage, getSession } = useApi()

const sessionKey = ref(`chat:${Date.now()}`)
const inputMessage = ref('')
const loading = ref(false)
const messages = ref<{ role: string; content: string }[]>([])
const messagesContainer = ref<HTMLElement | null>(null)

async function loadSession() {
    if (!sessionKey.value) return
    const session = await getSession(sessionKey.value)
    if (session?.messages) {
        messages.value = session.messages
        scrollToBottom()
    }
}

async function sendMessage() {
    if (!inputMessage.value.trim() || loading.value) return
    
    const userMessage = inputMessage.value.trim()
    inputMessage.value = ''
    
    messages.value.push({ role: 'user', content: userMessage })
    loading.value = true
    scrollToBottom()
    
    const response = await sendApiMessage(sessionKey.value, userMessage)
    
    if (response) {
        messages.value.push({ role: 'assistant', content: response })
    } else {
        messages.value.push({ role: 'assistant', content: '抱歉，发生了错误。' })
    }
    
    loading.value = false
    scrollToBottom()
}

function createNewSession() {
    sessionKey.value = `chat:${Date.now()}`
    messages.value = []
}

function scrollToBottom() {
    nextTick(() => {
        if (messagesContainer.value) {
            messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
        }
    })
}

watch(() => route.params.sessionKey, (newKey) => {
    if (newKey) {
        sessionKey.value = newKey as string
        loadSession()
    }
}, { immediate: true })

onMounted(() => {
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
    height: 100%;
    min-height: 100%;
}

.chat-header {
    padding: 16px;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.chat-header h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
}

.chat-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.session-input {
    width: 180px;
}

.chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    background: #f8fafc;
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
}

.message-wrapper.user .message-avatar {
    background: #e2e8f0;
}

.message-wrapper.assistant .message-avatar {
    background: #dbeafe;
}

.message-card {
    max-width: 70%;
    margin: 0;
}

.message-content {
    margin: 0;
    white-space: pre-wrap;
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
    border-top: 1px solid #e2e8f0;
}

.input-form {
    display: flex;
    gap: 8px;
}

.message-input {
    flex: 1;
}

@media (prefers-color-scheme: dark) {
    .chat-header {
        background: #1e293b;
        border-color: #334155;
    }
    .chat-header h1 {
        color: #f1f5f9;
    }
    .chat-messages {
        background: #0f172a;
    }
    .message-wrapper.user .message-avatar {
        background: #334155;
    }
    .message-wrapper.assistant .message-avatar {
        background: #1e3a5f;
    }
    .chat-input {
        background: #1e293b;
        border-color: #334155;
    }
}
</style>
