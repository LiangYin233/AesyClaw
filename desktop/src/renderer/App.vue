<template>
  <div class="app-layout">
    <!-- Topbar -->
    <header class="topbar">
      <div class="topbar-brand drag-region">
        <span class="brand-text">AesyClaw</span>
        <span class="brand-badge">Desktop</span>
      </div>
      <div class="topbar-right">
        <span class="connection-status" :class="statusClass">
          <span class="status-dot"></span>
          {{ statusLabel }}
        </span>
        <div class="window-controls">
          <button class="win-btn" @click="window.aesyclaw.minimizeWindow()" title="Minimize">
            <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5" width="12" height="1.5" rx="0.75" fill="currentColor"/></svg>
          </button>
          <button class="win-btn" @click="window.aesyclaw.maximizeWindow()" :title="isMaximized ? 'Restore' : 'Maximize'">
            <svg v-if="!isMaximized" width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
            <svg v-else width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="0.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="0.5" y="2.5" width="8" height="8" rx="1" fill="#fdfbf8" stroke="currentColor" stroke-width="1.2"/></svg>
          </button>
          <button class="win-btn win-close" @click="window.aesyclaw.closeWindow()" title="Close">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
    </header>

    <div class="app-body">
      <!-- Sidebar -->
      <aside class="sidebar">
        <nav class="sidebar-nav">
          <router-link to="/" class="nav-item" active-class="active">
            <span>💬</span>
            <span>Conversations</span>
          </router-link>
          <router-link to="/settings" class="nav-item" active-class="active">
            <span>⚙</span>
            <span>Settings</span>
          </router-link>
        </nav>
      </aside>

      <!-- Main -->
      <main class="main-content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { ConnectionStatus } from '../../preload/index';

const status = ref<ConnectionStatus>({ chat: 'disconnected', admin: 'disconnected' });
const isMaximized = ref(false);
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

onMounted(async () => {
  status.value = await window.aesyclaw.getStatus();
  isMaximized.value = await window.aesyclaw.isMaximized();
  unsubStatus = window.aesyclaw.onStatusChange((s) => { status.value = s; });
  unsubMaximize = window.aesyclaw.onMaximizeChange((m) => { isMaximized.value = m; });
});

onUnmounted(() => {
  unsubStatus?.();
  unsubMaximize?.();
});
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
  justify-content: space-between;
  padding: 0 24px;
  flex-shrink: 0;
  z-index: 10;
  user-select: none;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.drag-region {
  -webkit-app-region: drag;
  flex: 1;
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
  -webkit-app-region: no-drag;
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

/* ── Window controls ──────────────────── */
.window-controls {
  display: flex;
  gap: 2px;
  -webkit-app-region: no-drag;
  margin-left: 12px;
}

.win-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--color-mid-gray);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}
.win-btn:hover {
  background: rgba(20,20,19,0.08);
  color: var(--color-dark);
}
.win-btn.win-close:hover {
  background: var(--color-danger);
  color: #fff;
}

/* ── Body ───────────────────────────── */
.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ── Sidebar ────────────────────────── */
.sidebar {
  width: var(--sidebar-width);
  background: #faf7f4;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
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
  transition: all var(--transition-fast);
  position: relative;
}

.nav-item:hover {
  color: var(--color-dark);
  background: rgba(20, 20, 19, 0.04);
}

.nav-item.active {
  color: var(--color-dark);
  background: #f7f0ea;
}

.nav-item.active::before {
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

/* ── Main ───────────────────────────── */
.main-content {
  flex: 1;
  overflow: hidden;
  background: #faf7f4;
}
</style>
