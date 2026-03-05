<template>
    <div class="sessions-page">
        <div class="page-header">
            <h1>会话管理</h1>
            <Button icon="pi pi-refresh" label="刷新" @click="loadSessions" />
        </div>
        
        <Card>
            <template #content>
                <table class="sessions-table">
                    <thead>
                        <tr>
                            <th>渠道</th>
                            <th>聊天ID</th>
                            <th>UUID</th>
                            <th>消息数</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="session in sessions" :key="session.key">
                            <td><Tag :value="session.channel || '-'" severity="primary" /></td>
                            <td class="session-key">{{ session.chatId || session.key }}</td>
                            <td><Tag v-if="session.uuid" :value="session.uuid" severity="secondary" /></td>
                            <td><Tag :value="session.messageCount.toString()" severity="info" /></td>
                            <td>
                                <div class="action-buttons">
                                    <Button icon="pi pi-comments" text rounded title="继续聊天" @click="continueChat(session.key)" />
                                    <Button icon="pi pi-eye" text rounded title="查看详情" @click="viewSession(session)" />
                                    <Button icon="pi pi-trash" text rounded severity="danger" title="删除" @click="confirmDelete(session)" />
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
                
                <div v-if="!loading && sessions.length === 0" class="empty-state">
                    <span>暂无会话</span>
                </div>
            </template>
        </Card>
        
        <Dialog v-model:visible="detailVisible" :header="'会话详情: ' + selectedSession?.key" modal class="detail-dialog">
            <div v-if="selectedSessionDetails" class="detail-messages">
                <div v-for="(msg, index) in selectedSessionDetails.messages" :key="index" 
                     class="detail-message" :class="msg.role">
                    <div class="message-role">{{ msg.role }}</div>
                    <div class="message-content">{{ msg.content }}</div>
                </div>
            </div>
            <div v-else class="loading">
                <ProgressSpinner />
            </div>
        </Dialog>
        
        <Dialog v-model:visible="deleteVisible" header="确认删除" modal>
            <p>确定要删除会话 <span class="session-key">{{ selectedSession?.key }}</span> 吗？</p>
            <template #footer>
                <Button label="取消" text @click="deleteVisible = false" />
                <Button label="删除" severity="danger" @click="doDelete" />
            </template>
        </Dialog>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useApi, type Session } from '../composables/useApi'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import Dialog from 'primevue/dialog'
import ProgressSpinner from 'primevue/progressspinner'

const router = useRouter()
const { getSessions, getSession, deleteSession: deleteApiSession } = useApi()

const sessions = ref<Session[]>([])
const loading = ref(false)
const detailVisible = ref(false)
const deleteVisible = ref(false)
const selectedSession = ref<Session | null>(null)
const selectedSessionDetails = ref<any>(null)

async function loadSessions() {
    loading.value = true
    sessions.value = await getSessions()
    loading.value = false
}

function continueChat(key: string) {
    router.push(`/chat/${key}`)
}

async function viewSession(session: Session) {
    selectedSession.value = session
    selectedSessionDetails.value = await getSession(session.key)
    detailVisible.value = true
}

function confirmDelete(session: Session) {
    selectedSession.value = session
    deleteVisible.value = true
}

async function doDelete() {
    if (selectedSession.value) {
        await deleteApiSession(selectedSession.value.key)
        deleteVisible.value = false
        loadSessions()
    }
}

onMounted(() => {
    loadSessions()
})
</script>

<style scoped>
.sessions-page {
    padding: 0;
}

.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
}

.page-header h1 {
    margin: 0;
    font-size: 24px;
    font-weight: bold;
}

.sessions-table {
    width: 100%;
    border-collapse: collapse;
}

.sessions-table th,
.sessions-table td {
    padding: 12px;
    text-align: left;
    border-bottom: 1px solid #e2e8f0;
}

.sessions-table th {
    font-weight: 600;
    color: #64748b;
    font-size: 14px;
}

.session-key {
    font-family: monospace;
    font-size: 13px;
}

.action-buttons {
    display: flex;
    gap: 4px;
}

.empty-state {
    text-align: center;
    padding: 48px;
    color: #94a3b8;
}

.detail-dialog {
    width: 600px;
    max-width: 90vw;
}

.detail-messages {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 400px;
    overflow-y: auto;
}

.detail-message {
    padding: 8px 12px;
    border-radius: 8px;
}

.detail-message.user {
    background: #f1f5f9;
    margin-left: 32px;
}

.detail-message.assistant {
    background: #e0f2fe;
    margin-right: 32px;
}

.message-role {
    font-size: 12px;
    color: #64748b;
    margin-bottom: 4px;
}

.message-content {
    font-size: 14px;
    white-space: pre-wrap;
}

.loading {
    display: flex;
    justify-content: center;
    padding: 24px;
}

@media (prefers-color-scheme: dark) {
    .sessions-table th {
        color: #94a3b8;
    }
    .sessions-table td {
        border-color: #334155;
    }
    .detail-message.user {
        background: #334155;
    }
    .detail-message.assistant {
        background: #1e3a5f;
    }
}
</style>
