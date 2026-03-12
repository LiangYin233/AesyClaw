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

            <div v-if="!uiStore.isMobile" class="sidebar-brand">
                <div class="sidebar-brand-mark">A</div>
                <div class="sidebar-brand-copy">
                    <div class="sidebar-brand-title">AesyClaw</div>
                    <div class="sidebar-brand-subtitle">{{ currentNavLabel }}</div>
                </div>
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
    background:
        radial-gradient(circle at top left, rgba(59, 130, 246, 0.14), transparent 32%),
        radial-gradient(circle at top right, rgba(14, 165, 233, 0.12), transparent 24%),
        linear-gradient(180deg, #f8fbff 0%, #f1f5f9 48%, #eef2ff 100%);
}

.sidebar {
    width: 272px;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-height: 100vh;
    min-height: 100dvh;
    padding: 20px 16px 16px;
    gap: 16px;
    border-right: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(255, 255, 255, 0.82);
    backdrop-filter: blur(22px);
    box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.46);
    z-index: 30;
}

.sidebar-brand {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px;
    border-radius: 22px;
    background:
        linear-gradient(135deg, rgba(37, 99, 235, 0.14), rgba(56, 189, 248, 0.08)),
        rgba(255, 255, 255, 0.88);
    border: 1px solid rgba(59, 130, 246, 0.14);
    box-shadow: 0 16px 32px rgba(15, 23, 42, 0.08);
}

.sidebar-brand-mark {
    width: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 16px;
    font-size: 1.1rem;
    font-weight: 800;
    color: #eff6ff;
    background: linear-gradient(135deg, #2563eb, #0ea5e9);
    box-shadow: 0 12px 24px rgba(37, 99, 235, 0.28);
}

.sidebar-brand-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
}

.sidebar-brand-title {
    font-size: 0.98rem;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.02em;
}

.sidebar-brand-subtitle {
    font-size: 0.78rem;
    color: #64748b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sidebar-mobile-header {
    display: none;
}

.sidebar-nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
}

.nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 16px;
    color: #475569;
    text-decoration: none;
    transition:
        transform 0.18s ease,
        background-color 0.18s ease,
        color 0.18s ease,
        box-shadow 0.18s ease;
    position: relative;
}

.nav-item:hover {
    background: rgba(239, 246, 255, 0.92);
    color: #1d4ed8;
    transform: translateX(2px);
}

.nav-item:focus-visible {
    outline: 2px solid rgba(37, 99, 235, 0.28);
    outline-offset: 2px;
}

.nav-item-active {
    color: #1d4ed8;
    font-weight: 700;
    background:
        linear-gradient(135deg, rgba(219, 234, 254, 0.94), rgba(224, 242, 254, 0.82)),
        rgba(255, 255, 255, 0.82);
    box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.14);
}

.nav-item-active::before {
    content: '';
    position: absolute;
    left: -6px;
    top: 18%;
    bottom: 18%;
    width: 4px;
    border-radius: 999px;
    background: linear-gradient(180deg, #2563eb, #0ea5e9);
}

.nav-icon {
    width: 18px;
    font-size: 16px;
    text-align: center;
    flex-shrink: 0;
}

.nav-label {
    font-size: 0.92rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sidebar-footer {
    padding: 16px;
    border-radius: 20px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background:
        linear-gradient(135deg, rgba(248, 250, 252, 0.9), rgba(239, 246, 255, 0.92)),
        rgba(255, 255, 255, 0.78);
    box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05);
}

.footer-content {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.status-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.status-label {
    font-size: 11px;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.12em;
}

.app-name {
    font-size: 12px;
    font-weight: 700;
    color: #334155;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding-top: 10px;
    border-top: 1px solid rgba(148, 163, 184, 0.16);
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
    padding: 28px 32px 36px;
}

.main-content-inner :deep(> *) {
    width: 100%;
    max-width: var(--ui-page-max, 1440px);
    margin: 0 auto;
}

.mobile-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.45);
    backdrop-filter: blur(3px);
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
        width: min(300px, 86vw);
        min-height: 100dvh;
        padding: 0;
        gap: 0;
        transform: translateX(-100%);
        transition: transform 0.22s ease;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
    }

    .sidebar-mobile-open {
        transform: translateX(0);
    }

    .sidebar-mobile-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 14px 10px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    }

    .sidebar-mobile-brand {
        font-size: 16px;
        font-weight: 800;
        color: #0f172a;
        letter-spacing: -0.02em;
    }

    .sidebar-nav {
        padding: 14px;
    }

    .sidebar-footer {
        margin: 0 14px 14px;
    }

    .mobile-topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: rgba(255, 255, 255, 0.82);
        border-bottom: 1px solid rgba(148, 163, 184, 0.16);
        backdrop-filter: blur(18px);
    }

    .mobile-topbar-main {
        flex: 1;
        min-width: 0;
    }

    .mobile-topbar-title {
        font-size: 15px;
        font-weight: 800;
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
        padding: 18px 16px 24px;
    }
}

@media (max-width: 640px) {
    .main-content-inner {
        padding: 16px 14px 22px;
    }

    .mobile-topbar {
        padding-inline: 12px;
    }
}

@media (prefers-color-scheme: dark) {
    .layout-wrapper {
        background:
            radial-gradient(circle at top left, rgba(37, 99, 235, 0.22), transparent 34%),
            radial-gradient(circle at top right, rgba(14, 165, 233, 0.16), transparent 26%),
            linear-gradient(180deg, #020617 0%, #0f172a 52%, #111827 100%);
    }

    .sidebar {
        background: rgba(2, 6, 23, 0.76);
        border-right-color: rgba(148, 163, 184, 0.14);
        box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.03);
    }

    .sidebar-brand,
    .sidebar-footer,
    .mobile-topbar {
        background:
            linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.84)),
            rgba(15, 23, 42, 0.82);
        border-color: rgba(148, 163, 184, 0.14);
    }

    .sidebar-brand-title,
    .mobile-topbar-title {
        color: #f8fafc;
    }

    .sidebar-brand-subtitle,
    .status-label,
    .mobile-topbar-subtitle {
        color: #94a3b8;
    }

    .nav-item {
        color: #cbd5e1;
    }

    .nav-item:hover {
        background: rgba(30, 41, 59, 0.86);
        color: #bfdbfe;
    }

    .nav-item-active {
        color: #bfdbfe;
        background:
            linear-gradient(135deg, rgba(30, 41, 59, 0.96), rgba(30, 64, 175, 0.32)),
            rgba(30, 41, 59, 0.88);
        box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.14);
    }

    .app-name {
        color: #e2e8f0;
        border-top-color: rgba(148, 163, 184, 0.12);
    }

    .sidebar-mobile-brand {
        color: #f8fafc;
    }
}
</style>
