<template>
  <div class="app-layout">
    <header class="topbar">
      <div class="topbar-brand">
        <span class="brand-text">AesyClaw</span>
        <span class="brand-badge">Desktop</span>
      </div>
      <div class="topbar-drag-region" aria-hidden="true"></div>
      <div class="topbar-right">
        <span class="connection-status" :class="statusClass">
          <span class="status-dot"></span>
          {{ statusLabel }}
        </span>
        <div class="window-controls">
          <button
            class="win-btn"
            title="Minimize"
            aria-label="Minimize window"
            @click="handleMinimize"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect y="5" width="12" height="1.5" rx="0.75" fill="currentColor" />
            </svg>
          </button>
          <button
            class="win-btn"
            :title="isMaximized ? 'Restore' : 'Maximize'"
            :aria-label="isMaximized ? 'Restore window' : 'Maximize window'"
            @click="handleMaximize"
          >
            <svg v-if="!isMaximized" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect
                x="1"
                y="1"
                width="10"
                height="10"
                rx="1"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
              />
            </svg>
            <svg v-else width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect
                x="2.5"
                y="0.5"
                width="8"
                height="8"
                rx="1"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
              />
              <rect
                x="0.5"
                y="2.5"
                width="8"
                height="8"
                rx="1"
                fill="#fdfbf8"
                stroke="currentColor"
                stroke-width="1.2"
              />
            </svg>
          </button>
          <button
            class="win-btn win-close"
            title="Close"
            aria-label="Close window"
            @click="handleClose"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M1 1l10 10M11 1L1 11"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <div class="app-body">
      <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
        <nav class="sidebar-nav">
          <router-link to="/" class="nav-item" title="Conversations">
            <svg
              class="nav-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span class="nav-label">Conversations</span>
          </router-link>
          <router-link to="/settings" class="nav-item" title="Settings">
            <svg
              class="nav-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
            <span class="nav-label">Settings</span>
          </router-link>
        </nav>
        <div class="sidebar-footer">
          <button
            class="sidebar-toggle"
            type="button"
            :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
            :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
            :aria-expanded="!sidebarCollapsed"
            @click="toggleSidebar"
          >
            <svg
              class="sidebar-toggle-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
      </aside>

      <main class="main-content">
        <router-view />
      </main>

      <div v-if="isDisconnected" class="disconnect-overlay" role="alert" aria-live="assertive">
        <div class="disconnect-card">
          <span class="disconnect-icon" aria-hidden="true">!</span>
          <div>
            <h2>Disconnected</h2>
            <p>Connection lost.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { ConnectionStatus } from '../../preload/index';

const status = ref<ConnectionStatus>({ chat: 'disconnected', admin: 'disconnected' });
const isMaximized = ref(false);
const sidebarCollapsed = ref(localStorage.getItem('desktop-sidebar-collapsed') === 'true');
let unsubStatus: (() => void) | null = null;
let unsubMaximize: (() => void) | null = null;

const statusClass = computed(() => {
  if (status.value.chat === 'connected') return 'ok';
  if (status.value.chat === 'connecting') return 'warn';
  return 'err';
});

const statusLabel = computed(() => {
  if (status.value.chat === 'connected') return 'Connected';
  if (status.value.chat === 'connecting') return 'Connecting…';
  return 'Disconnected';
});

const isDisconnected = computed(() => status.value.chat === 'disconnected');

onMounted(async () => {
  status.value = await window.aesyclaw.getStatus();
  isMaximized.value = await window.aesyclaw.isMaximized();
  unsubStatus = window.aesyclaw.onStatusChange((s) => {
    status.value = s;
  });
  unsubMaximize = window.aesyclaw.onMaximizeChange((m) => {
    isMaximized.value = m;
  });
});

onUnmounted(() => {
  unsubStatus?.();
  unsubMaximize?.();
});

function handleMinimize(): void {
  void window.aesyclaw.minimizeWindow();
}
function handleMaximize(): void {
  void window.aesyclaw.maximizeWindow();
}
function handleClose(): void {
  void window.aesyclaw.closeWindow();
}
function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem('desktop-sidebar-collapsed', String(sidebarCollapsed.value));
}
</script>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* ── Topbar ─────────────────────────── */
.topbar {
  height: var(--topbar-height);
  background: #fdfbf8;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  padding: 0 12px 0 24px;
  flex-shrink: 0;
  z-index: 10;
  user-select: none;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.topbar-drag-region {
  align-self: stretch;
  flex: 1;
  min-width: 24px;
  -webkit-app-region: drag;
}

.brand-text {
  font-family: var(--font-heading);
  font-size: 16px;
  font-weight: 600;
  color: var(--color-dark);
  letter-spacing: -0.02em;
}

.brand-badge {
  font-family: var(--font-heading);
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--color-mid-gray);
  background: #f8f7f4;
  padding: 0.15rem 0.5rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.window-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 12px;
  -webkit-app-region: no-drag;
}

.win-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-mid-gray);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
  -webkit-app-region: no-drag;
}
.win-btn svg {
  pointer-events: none;
}
.win-btn:hover {
  background: rgba(20, 20, 19, 0.08);
  color: var(--color-dark);
}
.win-btn:active {
  background: rgba(20, 20, 19, 0.12);
}
.win-btn.win-close:hover {
  background: var(--color-danger);
  color: #fff;
}

.connection-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-heading);
  font-size: 12px;
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: #fdfbf9;
  user-select: none;
}
.connection-status.ok {
  color: var(--color-accent-green);
}
.connection-status.warn {
  color: var(--color-warning);
}
.connection-status.err {
  color: var(--color-mid-gray);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

/* ── Body ───────────────────────────── */
.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  position: relative;
}

.disconnect-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(250, 247, 244, 0.72);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  cursor: not-allowed;
}

.disconnect-card {
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: 360px;
  padding: 18px 20px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: rgba(253, 251, 249, 0.94);
  box-shadow: var(--shadow-lg);
  pointer-events: none;
}

.disconnect-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(196, 91, 91, 0.12);
  color: var(--color-danger);
  font-family: var(--font-heading);
  font-weight: 600;
  flex-shrink: 0;
}

.disconnect-card h2 {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 15px;
  color: var(--color-dark);
}

.disconnect-card p {
  margin: 2px 0 0;
  color: var(--color-mid-gray);
  font-size: 13px;
}

/* ── Sidebar ────────────────────────── */
.sidebar {
  width: var(--sidebar-width);
  background: #faf7f4;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width var(--transition);
}

.sidebar.collapsed {
  width: var(--sidebar-collapsed-width);
}

.sidebar-footer {
  display: flex;
  justify-content: flex-end;
  padding: 4px 12px 12px;
}

.sidebar-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-mid-gray);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast),
    border-color var(--transition-fast);
}

.sidebar-toggle:hover {
  color: var(--color-dark);
  background: rgba(20, 20, 19, 0.04);
  border-color: var(--color-border);
}

.sidebar-toggle-icon {
  transition: transform var(--transition-fast);
}

.sidebar.collapsed .sidebar-footer {
  justify-content: center;
}

.sidebar.collapsed .sidebar-toggle-icon {
  transform: rotate(180deg);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 4px;
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0.7rem 16px;
  border-radius: var(--radius-sm);
  color: var(--color-mid-gray);
  text-decoration: none;
  font-family: var(--font-heading);
  font-size: 14px;
  font-weight: 500;
  transition:
    color var(--transition-fast),
    background var(--transition-fast),
    padding var(--transition-fast),
    gap var(--transition-fast);
  position: relative;
  overflow: hidden;
}

.nav-item:hover {
  color: var(--color-dark);
  background: rgba(20, 20, 19, 0.04);
}

.nav-item.router-link-active {
  color: var(--color-dark);
  background: #f7f0ea;
}

.nav-item.router-link-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  background: var(--color-primary);
  border-radius: 0 3px 3px 0;
}

.nav-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.nav-label {
  max-width: 140px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  opacity: 1;
  transition:
    opacity var(--transition-fast),
    max-width var(--transition-fast);
}

.sidebar.collapsed .sidebar-nav {
  padding-inline: 10px;
}

.sidebar.collapsed .nav-item {
  justify-content: center;
  gap: 0;
  padding: 0.7rem 0;
}

.sidebar.collapsed .nav-label {
  max-width: 0;
  opacity: 0;
}

/* ── Main ───────────────────────────── */
.main-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: #faf7f4;
}
</style>
