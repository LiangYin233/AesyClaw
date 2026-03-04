<template>
    <div class="layout-wrapper">
        <aside class="sidebar">
            <div class="sidebar-header">
                <i class="pi pi-bolt"></i>
                <span>AesyClaw</span>
            </div>
            <nav class="sidebar-nav">
                <router-link v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item" exact-active-class="nav-item-active">
                    <i :class="item.icon"></i>
                    <span>{{ item.label }}</span>
                </router-link>
            </nav>
            <div class="sidebar-footer">
                <Tag :value="agentRunning ? '运行中' : '已停止'" 
                     :severity="agentRunning ? 'success' : 'danger'" />
            </div>
        </aside>
        <main class="main-content">
            <router-view />
        </main>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useApi } from '../composables/useApi'
import Tag from 'primevue/tag'

const { getStatus } = useApi()
const agentRunning = ref(false)

const navItems = [
    { path: '/', label: '仪表盘', icon: 'pi pi-home' },
    { path: '/chat', label: '聊天', icon: 'pi pi-comments' },
    { path: '/sessions', label: '会话', icon: 'pi pi-list' },
    { path: '/cron', label: '定时任务', icon: 'pi pi-clock' },
    { path: '/tools', label: '工具', icon: 'pi pi-box' },
    { path: '/plugins', label: '插件', icon: 'pi pi-th-large' },
    { path: '/config', label: '配置', icon: 'pi pi-cog' }
]

let interval: number

async function checkStatus() {
    const status = await getStatus()
    if (status) {
        agentRunning.value = status.agentRunning
    }
}

onMounted(() => {
    checkStatus()
    interval = window.setInterval(checkStatus, 5000)
})

onUnmounted(() => {
    clearInterval(interval)
})
</script>

<style scoped>
.layout-wrapper {
    display: flex;
    height: 100vh;
    overflow: hidden;
}

.sidebar {
    width: 200px;
    background: #ffffff;
    border-right: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    height: 100%;
}

.sidebar-header {
    padding: 16px;
    font-size: 20px;
    font-weight: bold;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    gap: 8px;
    color: #334155;
}

.sidebar-nav {
    flex: 1;
    padding: 8px;
}

.nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    color: #64748b;
    text-decoration: none;
    margin-bottom: 4px;
    transition: all 0.2s;
}

.nav-item:hover {
    background: #f1f5f9;
    color: #475569;
}

.nav-item-active {
    background: #e2e8f0;
    color: #334155;
    font-weight: 500;
}

.sidebar-footer {
    padding: 16px;
    border-top: 1px solid #e2e8f0;
}

.main-content {
    flex: 1;
    overflow-y: auto;
    min-width: 0;
    background: #f8fafc;
    height: 100%;
}

@media (prefers-color-scheme: dark) {
    .sidebar {
        background: #1e293b;
        border-color: #334155;
    }
    .sidebar-header {
        border-color: #334155;
        color: #f1f5f9;
    }
    .nav-item {
        color: #94a3b8;
    }
    .nav-item:hover {
        background: #334155;
        color: #e2e8f0;
    }
    .nav-item-active {
        background: #475569;
        color: #f8fafc;
        font-weight: 500;
    }
    .sidebar-footer {
        border-color: #334155;
    }
    .main-content {
        background: #0f172a;
    }
}
</style>
