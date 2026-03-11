<template>
    <div class="layout-wrapper">
        <aside class="sidebar" role="navigation" :aria-label="ARIA_LABELS.mainNavigation">
            <nav class="sidebar-nav">
                <router-link
                    v-for="item in navItems"
                    :key="item.path"
                    :to="{ path: item.path, query: tokenQuery }"
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
                <div class="footer-content">
                    <div class="status-row">
                        <span class="status-label">Agent 状态</span>
                        <Tag
                            :value="systemStore.agentRunning ? '运行中' : '已停止'"
                            :severity="systemStore.agentRunning ? 'success' : 'danger'"
                            rounded
                            :aria-label="`Agent 当前状态：${systemStore.agentRunning ? '运行中' : '已停止'}`"
                        />
                    </div>
                    <div class="app-name">AesyClaw</div>
                </div>
            </div>
        </aside>
        <main class="main-content" role="main" aria-label="主要内容">
            <div class="main-content-inner">
                <router-view />
            </div>
        </main>

        <Toast position="top-right" />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getRouteToken } from '../utils/auth'
import { useSystemStore } from '../stores/system'
import { useNavigationShortcuts, showKeyboardHelp, useKeyboard } from '../composables/useKeyboard'
import { injectScreenReaderStyles, announceToScreenReader } from '../composables/useA11y'
import { ARIA_LABELS } from '../constants/a11y'
import Tag from 'primevue/tag'
import Toast from 'primevue/toast'

const route = useRoute()
const systemStore = useSystemStore()

const tokenQuery = computed(() => {
    const token = getRouteToken(route)
    return token ? { token } : {}
})

const navItems = [
    { path: '/', label: '仪表盘', icon: 'pi pi-home' },
    { path: '/chat', label: '聊天', icon: 'pi pi-comments' },
    { path: '/sessions', label: '会话', icon: 'pi pi-list' },
    { path: '/memory', label: '记忆', icon: 'pi pi-bookmark' },
    { path: '/agents', label: 'Agent', icon: 'pi pi-users' },
    { path: '/cron', label: '定时任务', icon: 'pi pi-clock' },
    { path: '/tools', label: '工具', icon: 'pi pi-box' },
    { path: '/plugins', label: '插件', icon: 'pi pi-th-large' },
    { path: '/mcp', label: 'MCP', icon: 'pi pi-server' },
    { path: '/skills', label: 'Skills', icon: 'pi pi-star' },
    { path: '/logs', label: '日志', icon: 'pi pi-file' },
    { path: '/config', label: '配置', icon: 'pi pi-cog' }
]

const isCurrentRoute = (path: string) => {
    return route.path === path || (path === '/' && route.path === '/')
}

watch(() => systemStore.agentRunning, (newStatus, oldStatus) => {
    if (oldStatus !== undefined && newStatus !== oldStatus) {
        announceToScreenReader(
            `Agent 状态已变更为${newStatus ? '运行中' : '已停止'}`,
            'polite'
        )
    }
})

useNavigationShortcuts()

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
    injectScreenReaderStyles()
    systemStore.startPolling(5000)
})

onUnmounted(() => {
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
    background: #3b82f6;
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
    background: linear-gradient(to right, #f9fafb, #eff6ff);
}

.footer-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.status-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.status-label {
    font-size: 12px;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}

.app-name {
    font-size: 13px;
    font-weight: 600;
    color: #1e293b;
    text-align: center;
    letter-spacing: 0.05em;
    padding-top: 8px;
    border-top: 1px solid #e2e8f0;
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
}
</style>
