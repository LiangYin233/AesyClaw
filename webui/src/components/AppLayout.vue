<template>
  <div class="console-shell" :class="{ 'console-shell--mobile': uiStore.isMobile }">
    <div v-if="uiStore.isMobile && uiStore.mobileSidebarOpen" class="console-shell__backdrop" @click="uiStore.closeMobileSidebar"></div>

    <aside class="console-sidebar" :class="{ 'console-sidebar--open': !uiStore.isMobile || uiStore.mobileSidebarOpen }" :aria-label="ARIA_LABELS.sidebar">
      <div class="console-sidebar__brand">
        <div class="console-sidebar__mark">A</div>
        <div>
          <div class="console-sidebar__title">AesyClaw 控制台</div>
          <div class="console-sidebar__subtitle">{{ currentNavLabel }}</div>
        </div>
      </div>

      <nav class="console-sidebar__nav" :aria-label="ARIA_LABELS.mainNav">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="{ path: item.path, query: tokenQuery }"
          class="console-nav-item"
          :class="{ 'console-nav-item--active': isCurrentRoute(item.path) }"
          @click="handleNavClick"
        >
          <UiIcon :name="item.icon" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="console-sidebar__footer">
        <div class="console-sidebar__status">
          <span>运行状态</span>
          <UiBadge :value="systemStore.agentRunning ? '在线' : '停止'" :severity="systemStore.agentRunning ? 'success' : 'danger'" rounded />
        </div>
        <div class="console-sidebar__meta">版本 {{ systemStore.version }}</div>
      </div>
    </aside>

    <div class="console-main">
      <header class="console-topbar">
        <div class="console-topbar__left">
          <UiButton v-if="uiStore.isMobile" icon="bars" text rounded :aria-label="ARIA_LABELS.mobileMenuToggle" @click="uiStore.openMobileSidebar" />
          <div>
            <div class="console-topbar__eyebrow">中文控制台</div>
            <div class="console-topbar__title">{{ currentNavLabel }}</div>
          </div>
        </div>
        <div class="console-topbar__actions">
          <div class="console-topbar__status">
            <span class="console-topbar__dot" :class="{ 'console-topbar__dot--active': systemStore.agentRunning }"></span>
            <span>{{ systemStore.agentRunning ? 'Agent 运行中' : 'Agent 已停止' }}</span>
          </div>
          <UiButton
            :label="uiStore.isDark ? '浅色' : '深色'"
            :icon="uiStore.isDark ? 'info' : 'circle-fill'"
            outlined
            @click="uiStore.toggleTheme"
          />
        </div>
      </header>

      <main class="console-content" role="main">
        <router-view v-slot="{ Component }">
          <transition name="console-fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>

    <UiToastViewport />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import UiBadge from './ui/UiBadge.vue'
import UiButton from './ui/UiButton.vue'
import UiIcon from './ui/UiIcon.vue'
import UiToastViewport from './ui/UiToastViewport.vue'
import { getRouteToken } from '../utils/auth'
import { useSystemStore, useUiStore } from '../stores'
import { injectScreenReaderStyles } from '../composables/useA11y'
import { ARIA_LABELS } from '../constants/a11y'

const MOBILE_BREAKPOINT = 960

const route = useRoute()
const systemStore = useSystemStore()
const uiStore = useUiStore()

const navItems = [
  { path: '/overview', label: '总览', icon: 'home' },
  { path: '/dialogue', label: '对话', icon: 'comments' },
  { path: '/sessions', label: '会话', icon: 'list' },
  { path: '/memory', label: '记忆', icon: 'bookmark' },
  { path: '/agents', label: 'Agent', icon: 'users' },
  { path: '/skills', label: '技能', icon: 'star' },
  { path: '/tools', label: '工具', icon: 'box' },
  { path: '/plugins', label: '插件', icon: 'plug' },
  { path: '/cron', label: '定时任务', icon: 'clock' },
  { path: '/mcp', label: 'MCP', icon: 'server' },
  { path: '/observability/logs', label: '观测', icon: 'file' },
  { path: '/settings/config', label: '设置', icon: 'cog' }
]

const currentNavLabel = computed(() => {
  return navItems.find((item) => isCurrentRoute(item.path))?.label ?? '控制台'
})

const tokenQuery = computed(() => {
  const token = getRouteToken(route)
  return token ? { token } : {}
})

const syncViewport = () => {
  uiStore.setMobile(window.innerWidth <= MOBILE_BREAKPOINT)
}

const handleNavClick = () => {
  if (uiStore.isMobile) {
    uiStore.closeMobileSidebar()
  }
}

const isCurrentRoute = (path: string) => route.path === path || route.path.startsWith(`${path}/`)

watch(() => route.fullPath, handleNavClick)

onMounted(() => {
  injectScreenReaderStyles()
  syncViewport()
  window.addEventListener('resize', syncViewport)
  systemStore.startPolling(5000)
})

onUnmounted(() => {
  window.removeEventListener('resize', syncViewport)
  systemStore.stopPolling()
})
</script>

<style scoped>
.console-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--ui-accent) 16%, transparent), transparent 30%),
    radial-gradient(circle at top right, color-mix(in srgb, var(--ui-info) 16%, transparent), transparent 24%),
    linear-gradient(180deg, var(--ui-bg) 0%, var(--ui-bg-elevated) 100%);
}

.console-shell--mobile {
  grid-template-columns: minmax(0, 1fr);
}

.console-shell__backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(15, 23, 42, 0.32);
  backdrop-filter: blur(6px);
}

.console-sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  padding: 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background: color-mix(in srgb, var(--ui-panel) 88%, transparent);
  border-right: 1px solid var(--ui-border);
  backdrop-filter: blur(20px);
  z-index: 70;
}

.console-shell--mobile .console-sidebar {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: min(320px, calc(100vw - 2.5rem));
  transform: translateX(-110%);
  transition: transform 0.2s ease;
}

.console-shell--mobile .console-sidebar--open {
  transform: translateX(0);
}

.console-sidebar__brand {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.9rem;
  border-radius: 1.3rem;
  background: linear-gradient(135deg, color-mix(in srgb, var(--ui-accent) 16%, var(--ui-panel)), color-mix(in srgb, var(--ui-info) 8%, var(--ui-panel)));
  border: 1px solid color-mix(in srgb, var(--ui-accent) 14%, transparent);
}

.console-sidebar__mark {
  width: 2.7rem;
  height: 2.7rem;
  border-radius: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ui-accent);
  color: var(--ui-on-accent);
  font-weight: 800;
}

.console-sidebar__title {
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--ui-text-strong);
}

.console-sidebar__subtitle {
  margin-top: 0.2rem;
  font-size: 0.78rem;
  color: var(--ui-text-muted);
}

.console-sidebar__nav {
  display: grid;
  gap: 0.35rem;
}

.console-nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 2.8rem;
  padding: 0 0.95rem;
  border-radius: 1rem;
  color: var(--ui-text-muted);
  text-decoration: none;
  font-weight: 650;
  transition: background-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.console-nav-item:hover,
.console-nav-item--active {
  background: color-mix(in srgb, var(--ui-accent) 12%, var(--ui-panel));
  color: var(--ui-accent-strong);
  transform: translateX(2px);
}

.console-sidebar__footer {
  margin-top: auto;
  padding: 1rem;
  border-radius: 1.2rem;
  background: var(--ui-panel-alt);
  border: 1px solid var(--ui-border-subtle);
}

.console-sidebar__status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: var(--ui-text-soft);
  font-size: 0.84rem;
}

.console-sidebar__meta {
  margin-top: 0.8rem;
  color: var(--ui-text-faint);
  font-size: 0.74rem;
}

.console-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.console-topbar {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 4.5rem;
  padding: 0 1.4rem;
  border-bottom: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg) 72%, transparent);
  backdrop-filter: blur(18px);
}

.console-topbar__left,
.console-topbar__actions {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}

.console-topbar__eyebrow {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ui-text-faint);
}

.console-topbar__title {
  font-size: 1.08rem;
  font-weight: 800;
  color: var(--ui-text-strong);
}

.console-topbar__status {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.8rem;
  min-height: 2.5rem;
  border-radius: 999px;
  background: var(--ui-panel);
  border: 1px solid var(--ui-border-subtle);
  color: var(--ui-text-soft);
  font-size: 0.84rem;
}

.console-topbar__dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  background: var(--ui-danger);
}

.console-topbar__dot--active {
  background: var(--ui-success);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--ui-success) 18%, transparent);
}

.console-content {
  padding: 1.5rem;
}

.console-fade-enter-active,
.console-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.console-fade-enter-from,
.console-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

@media (max-width: 960px) {
  .console-topbar,
  .console-content {
    padding-left: 1rem;
    padding-right: 1rem;
  }

  .console-topbar__actions {
    gap: 0.55rem;
  }

  .console-topbar__status {
    display: none;
  }
}
</style>
