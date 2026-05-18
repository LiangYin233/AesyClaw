<template>
  <div class="settings-view">
    <h1 class="page-title">Settings</h1>
    <p class="page-subtitle">Connection status and configuration overview.</p>

    <!-- Connection -->
    <section class="card">
      <h2 class="section-title">Connection</h2>
      <div class="card-body">
        <div class="info-row">
          <span class="info-label">Chat Server</span>
          <span class="info-value">
            <span class="badge" :class="statusBadge(status.chat)">{{ statusLabel(status.chat) }}</span>
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">Admin Server</span>
          <span class="info-value">
            <span class="badge" :class="statusBadge(status.admin)">{{ statusLabel(status.admin) }}</span>
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">Desktop Channel Port</span>
          <span class="info-value">9730</span>
        </div>
      </div>
    </section>

    <!-- Server Info -->
    <section class="card">
      <h2 class="section-title">Server Information</h2>
      <div v-if="loading" class="card-body">
        <span class="dim-text">Loading…</span>
      </div>
      <div v-else-if="serverInfo" class="card-body">
        <div class="info-row">
          <span class="info-label">Application</span>
          <span class="info-value">{{ serverInfo.appName ?? '-' }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Version</span>
          <span class="info-value">{{ serverInfo.version ?? '-' }}</span>
        </div>
      </div>
      <div v-else class="card-body">
        <span class="dim-text">Unable to reach AesyClaw server</span>
      </div>
    </section>

    <!-- Config -->
    <section class="card">
      <h2 class="section-title">Desktop Channel Configuration</h2>
      <div class="card-body">
        <p class="hint">
          Configure the desktop channel in <code>.aesyclaw/config.json</code>:
        </p>
        <pre class="config-block">{
  "channels": {
    "desktop": {
      "enabled": true,
      "port": 9730,
      "host": "127.0.0.1"
    }
  }
}</pre>
        <p class="hint">
          Advanced configuration — including roles, tools, skills, and providers — is managed
          through the AesyClaw web dashboard at the admin server.
        </p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { ConnectionStatus } from '../../preload/index';

const status = ref<ConnectionStatus>({ chat: 'disconnected', admin: 'disconnected' });
const serverInfo = ref<Record<string, string> | null>(null);
const loading = ref(true);

onMounted(async () => {
  status.value = await window.aesyclaw.getStatus();
  window.aesyclaw.onStatusChange((s) => { status.value = s; });

  try {
    const res = await window.aesyclaw.adminRequest('status');
    if (res.ok && res.data) {
      serverInfo.value = res.data as Record<string, string>;
    }
  } catch { /* server unavailable */ }
  loading.value = false;
});

function statusBadge(s: string): string {
  if (s === 'connected') return 'ok';
  if (s === 'connecting') return 'warn';
  return 'err';
}
function statusLabel(s: string): string {
  if (s === 'connected') return 'Connected';
  if (s === 'connecting') return 'Connecting…';
  return 'Disconnected';
}
</script>

<style scoped>
.settings-view {
  max-width: 680px;
  padding: 32px 40px;
}

/* ── Cards ───────────────────────────── */
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
}

.section-title {
  font-family: var(--font-heading);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-mid-gray);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 16px;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Info rows ───────────────────────── */
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
}
.info-row:last-child { border-bottom: none; }

.info-label {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-mid-gray);
}
.info-value {
  font-family: var(--font-heading);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-dark);
}

/* ── Badge ───────────────────────────── */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  font-family: var(--font-heading);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.03em;
}
.badge.ok {
  background: rgba(120, 140, 93, 0.12);
  color: #5a6e47;
}
.badge.warn {
  background: rgba(201, 163, 90, 0.15);
  color: #a08040;
}
.badge.err {
  background: rgba(176, 174, 165, 0.2);
  color: #8a8880;
}

/* ── Misc ────────────────────────────── */
.dim-text {
  font-family: var(--font-body);
  font-style: italic;
  color: var(--color-mid-gray);
  font-size: 14px;
}

.hint {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-mid-gray);
  margin: 0 0 10px;
  line-height: 1.6;
}
.hint:last-child { margin-bottom: 0; }
.hint code {
  font-family: 'SF Mono', 'Menlo', monospace;
  background: #f5f3ef;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-dark);
}

.config-block {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 12px;
  background: #fdfbf8;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
  margin: 8px 0 16px;
  color: var(--color-dark);
  line-height: 1.6;
  overflow-x: auto;
}
</style>
