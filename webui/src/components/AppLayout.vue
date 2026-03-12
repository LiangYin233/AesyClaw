<template>
    <div class="layout-wrapper" :class="{ 'layout-mobile': uiStore.isMobile }">
        <div
            v-if="uiStore.isMobile && uiStore.mobileSidebarOpen"
            class="mobile-backdrop"
            aria-hidden="true"
            @click="uiStore.closeMobileSidebar"
        ></div>

        <aside
            class="sidebar"
            :class="{
                'sidebar-mobile': uiStore.isMobile,
                'sidebar-mobile-open': uiStore.isMobile && uiStore.mobileSidebarOpen
            }"
            role="navigation"
            :aria-label="ARIA_LABELS.mainNavigation"
        >
            <div v-if="uiStore.isMobile" class="sidebar-mobile-header">
                <div class="sidebar-mobile-brand">AesyClaw</div>
                <Button
                    icon="pi pi-times"
                    text
                    rounded
                    aria-label="关闭导航菜单"
                    @click="uiStore.closeMobileSidebar"
                />
            </div>

            <nav class="sidebar-nav">
                <router-link
                    v-for="item in navItems"
                    :key="item.path"
                    :to="{ path: item.path, query: tokenQuery }"
                    class="nav-item"
                    exact-active-class="nav-item-active"
                    :aria-label="item.label"
                    :aria-current="isCurrentRoute(item.path) ? 'page' : undefined"
                    @click="handleNavClick"
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
            <header v-if="uiStore.isMobile" class="mobile-topbar">
                <Button
                    icon="pi pi-bars"
                    text
                    rounded
                    aria-label="打开导航菜单"
                    @click="uiStore.openMobileSidebar"
                />
                <div class="mobile-topbar-main">
                    <div class="mobile-topbar-title">{{ currentNavLabel }}</div>
                    <div class="mobile-topbar-subtitle">AesyClaw 控制台</div>
                </div>
                <Tag
                    :value="systemStore.agentRunning ? '运行中' : '已停止'"
                    :severity="systemStore.agentRunning ? 'success' : 'danger'"
                    rounded
                />
            </header>

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
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Toast from 'primevue/toast'
import { getRouteToken } from '../utils/auth'
import { useSystemStore } from '../stores/system'
import { useUiStore } from '../stores/ui'
import { useNavigationShortcuts, showKeyboardHelp, useKeyboard } from '../composables/useKeyboard'
import { injectScreenReaderStyles, announceToScreenReader } from '../composables/useA11y'
import { ARIA_LABELS } from '../constants/a11y'

const MOBILE_BREAKPOINT = 960

const route = useRoute()
const systemStore = useSystemStore()
const uiStore = useUiStore()

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

const currentNavLabel = computed(() => {
    const currentItem = navItems.find((item) => {
        if (item.path === '/') {
            return route.path === '/'
        }
        return route.path === item.path || route.path.startsWith(`${item.path}/`)
    })

    return currentItem?.label ?? 'AesyClaw'
})

const isCurrentRoute = (path: string) => {
    return route.path === path || (path === '/' && route.path === '/')
}

const syncViewport = () => {
    uiStore.setMobile(window.innerWidth <= MOBILE_BREAKPOINT)
}

const syncBodyScroll = () => {
    document.body.style.overflow = uiStore.isMobile && uiStore.mobileSidebarOpen ? 'hidden' : ''
}

const handleNavClick = () => {
    if (uiStore.isMobile) {
        uiStore.closeMobileSidebar()
    }
}

watch(() => systemStore.agentRunning, (newStatus, oldStatus) => {
    if (oldStatus !== undefined && newStatus !== oldStatus) {
        announceToScreenReader(
            `Agent 状态已变更为${newStatus ? '运行中' : '已停止'}`,
            'polite'
        )
    }
})

watch(() => route.fullPath, () => {
    if (uiStore.isMobile) {
        uiStore.closeMobileSidebar()
    }
})

watch(
    () => [uiStore.isMobile, uiStore.mobileSidebarOpen],
    () => {
        syncBodyScroll()
    },
    { immediate: true }
)

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
    syncViewport()
    window.addEventListener('resize', syncViewport)
    systemStore.startPolling(5000)
})

onUnmounted(() => {
    window.removeEventListener('resize', syncViewport)
    document.body.style.overflow = ''
    systemStore.stopPolling()
})
</script>

<style scoped>
.layout-wrapper {
    position: relative;
    display: flex;
    min-height: 100vh;
    min-height: 100dvh;
    background: radial-gradient(circle at top left, #e0f2fe 0, #f8fafc 45%, #f1f5f9 100%);
}

.sidebar {
    width: 220px;
    background: #ffffff;
    border-right: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-height: 100vh;
    min-height: 100dvh;
    z-index: 30;
}

.sidebar-mobile-header {
    display: none;
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
    min-width: 0;
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
}

.mobile-topbar {
    display: none;
}

.main-content-inner {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: 24px 32px;
}

.mobile-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.45);
    backdrop-filter: blur(2px);
    z-index: 20;
}

@media (max-width: 960px) {
    .layout-wrapper {
        min-height: 100dvh;
    }

    .sidebar {
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        width: min(280px, 84vw);
        min-height: 100dvh;
        transform: translateX(-100%);
        transition: transform 0.2s ease;
        box-shadow: 0 20px 40px rgba(15, 23, 42, 0.18);
    }

    .sidebar-mobile-open {
        transform: translateX(0);
    }

    .sidebar-mobile-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 12px 8px;
        border-bottom: 1px solid #e2e8f0;
    }

    .sidebar-mobile-brand {
        font-size: 16px;
        font-weight: 700;
        color: #0f172a;
    }

    .mobile-topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        background: rgba(255, 255, 255, 0.92);
        border-bottom: 1px solid #e2e8f0;
        backdrop-filter: blur(12px);
    }

    .mobile-topbar-main {
        flex: 1;
        min-width: 0;
    }

    .mobile-topbar-title {
        font-size: 15px;
        font-weight: 700;
        color: #0f172a;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .mobile-topbar-subtitle {
        font-size: 12px;
        color: #64748b;
    }

    .main-content-inner {
        padding: 16px;
    }
}

@media (max-width: 640px) {
    .main-content-inner {
        padding: 14px;
    }

    .mobile-topbar {
        padding-inline: 12px;
    }
}
</style>
