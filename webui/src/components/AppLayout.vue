<template>
    <div class="layout-wrapper">
        <aside class="sidebar" role="navigation" :aria-label="ARIA_LABELS.sidebar">
            <div class="sidebar-header">
                <img src="../assets/AesyClaw.svg" alt="AesyClaw" class="app-logo" />
            </div>
            <nav class="sidebar-nav" :aria-label="ARIA_LABELS.mainNav">
                <router-link
                    v-for="item in navItems"
                    :key="item.path"
                    :to="item.path"
                    class="nav-item"
                    exact-active-class="nav-item-active"
                    :aria-label="item.label"
                    :aria-current="isCurrentRoute(item.path) ? 'page' : undefined"
                >
                    <i :class="item.icon" class="nav-icon" aria-hidden="true"></i>
                    <span class="nav-label">{{ item.label }}</span>
                </router-link>
            </nav>
            <div class="sidebar-footer" role="status" aria-live="polite">
                <span class="status-label">Agent 状态</span>
                <Tag
                    :value="systemStore.agentRunning ? '运行中' : '已停止'"
                    :severity="systemStore.agentRunning ? 'success' : 'danger'"
                    rounded
                    :aria-label="`Agent 当前状态：${systemStore.agentRunning ? '运行中' : '已停止'}`"
                />
            </div>
        </aside>
        <main class="main-content" role="main" aria-label="主要内容">
            <div class="main-content-inner">
                <router-view />
            </div>
        </main>

        <!-- Global Toast Container -->
        <Toast position="top-right" />
    </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSystemStore } from '../stores/system'
import { useNavigationShortcuts, showKeyboardHelp, useKeyboard } from '../composables/useKeyboard'
import { injectScreenReaderStyles, announceToScreenReader } from '../composables/useA11y'
import { ARIA_LABELS } from '../constants/a11y'
import Tag from 'primevue/tag'
import Toast from 'primevue/toast'

const route = useRoute()
const systemStore = useSystemStore()

const navItems = [
    { path: '/', label: '仪表盘', icon: 'pi pi-home' },
    { path: '/chat', label: '聊天', icon: 'pi pi-comments' },
    { path: '/sessions', label: '会话', icon: 'pi pi-list' },
    { path: '/cron', label: '定时任务', icon: 'pi pi-clock' },
    { path: '/tools', label: '工具', icon: 'pi pi-box' },
    { path: '/plugins', label: '插件', icon: 'pi pi-th-large' },
    { path: '/mcp', label: 'MCP', icon: 'pi pi-server' },
    { path: '/skills', label: 'Skills', icon: 'pi pi-star' },
    { path: '/logs', label: '日志', icon: 'pi pi-file' },
    { path: '/metrics', label: '监控', icon: 'pi pi-chart-line' },
    { path: '/config', label: '配置', icon: 'pi pi-cog' }
]

const isCurrentRoute = (path: string) => {
    return route.path === path || (path === '/' && route.path === '/')
}

// Watch for agent status changes and announce to screen readers
watch(() => systemStore.agentRunning, (newStatus, oldStatus) => {
    if (oldStatus !== undefined && newStatus !== oldStatus) {
        announceToScreenReader(
            `Agent 状态已变更为${newStatus ? '运行中' : '已停止'}`,
            'polite'
        )
    }
})

// Setup navigation shortcuts
useNavigationShortcuts()

// Setup help shortcut
useKeyboard([
    {
        key: '/',
        ctrl: true,
        handler: (e) => {
            e.preventDefault()
            showKeyboardHelp()
        },
        description: '显示键盘快捷键帮助'
    }
])

onMounted(() => {
    // Inject screen reader styles
    injectScreenReaderStyles()

    // Start polling system status
    systemStore.startPolling(5000)
})

onUnmounted(() => {
    // Stop polling when component unmounts
    systemStore.stopPolling()
})
</script>

<style scoped>
.layout-wrapper {
    display: flex;
    height: 100vh;
    overflow: hidden;
    background: radial-gradient(circle at top left, #e0f2fe 0, #f8fafc 45%, #f1f5f9 100%);
}

.sidebar {
    width: 220px;
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
    justify-content: center;
    gap: 10px;
    color: #0f172a;
}

.app-logo {
    height: 32px;
    width: auto;
    max-width: 100%;
    object-fit: contain;
}

.sidebar-nav {
    flex: 1;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
}

.nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    color: #64748b;
    text-decoration: none;
    transition: all 0.2s;
    position: relative;
}

.nav-item:hover {
    background: #eff6ff;
    color: #1d4ed8;
    transform: translateX(2px);
}

.nav-item:focus {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
}

.nav-item-active {
    background: #e0f2fe;
    color: #1d4ed8;
    font-weight: 600;
}

.nav-item-active::before {
    content: '';
    position: absolute;
    left: -8px;
    top: 10%;
    bottom: 10%;
    width: 3px;
    border-radius: 999px;
    background: linear-gradient(to bottom, #3b82f6, #22c55e);
}

.nav-icon {
    font-size: 16px;
}

.nav-label {
    font-size: 14px;
}

.sidebar-footer {
    padding: 16px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: linear-gradient(to right, #f9fafb, #eff6ff);
}

.status-label {
    font-size: 12px;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}

.main-content {
    flex: 1;
    overflow-y: auto;
    min-width: 0;
    background: transparent;
    height: 100%;
}

.main-content-inner {
    padding: 24px 32px;
    max-width: 1200px;
    margin: 0 auto;
    box-sizing: border-box;
}

@media (max-width: 1024px) {
    .sidebar {
        width: 200px;
    }

    .main-content-inner {
        padding: 20px 20px;
    }
}

@media (max-width: 768px) {
    .layout-wrapper {
        flex-direction: column;
    }

    .sidebar {
        width: 100%;
        height: auto;
        border-right: none;
        border-bottom: 1px solid #e2e8f0;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        padding-inline: 12px;
        gap: 12px;
    }

    .sidebar-nav {
        flex-direction: row;
        flex-wrap: nowrap;
        overflow-x: auto;
        padding: 8px 0;
    }

    .nav-item {
        padding-inline: 10px;
    }

    .nav-item-active::before {
        display: none;
    }

    .sidebar-footer {
        border-top: none;
        padding-inline: 0;
        background: transparent;
        align-items: flex-end;
    }

    .main-content {
        height: calc(100vh - 64px);
    }
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
    .nav-item:focus {
        outline-color: #60a5fa;
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

    .nav-item:hover {
        background: #1e293b;
        color: #bfdbfe;
    }

    .nav-item-active {
        background: #1d283a;
        color: #bfdbfe;
    }

    .sidebar-footer {
        background: linear-gradient(to right, #020617, #020617);
    }

    .status-label {
        color: #64748b;
    }
}
</style>
