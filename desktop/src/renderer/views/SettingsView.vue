<template>
  <div class="settings-view">
    <header class="settings-header">
      <div>
        <h1 class="page-title">Settings</h1>
        <p class="page-subtitle">Manage Desktop connection and app settings.</p>
      </div>
    </header>

    <div class="overview-grid">
      <!-- Connection -->
      <section class="card">
        <h2 class="section-title">Connection</h2>
        <div class="card-body">
          <div class="info-row">
            <span class="info-label">Chat Server</span>
            <span class="info-value">
              <span class="badge" :class="statusBadge(status.chat)">{{
                statusLabel(status.chat)
              }}</span>
            </span>
          </div>
          <div class="info-row">
            <span class="info-label">Admin Server</span>
            <span class="info-value">
              <span class="badge" :class="statusBadge(status.admin)">{{
                statusLabel(status.admin)
              }}</span>
            </span>
          </div>
          <div class="info-row">
            <span class="info-label">Host</span>
            <span class="info-value">{{ connection.host }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Desktop Channel Port</span>
            <span class="info-value">{{ connection.desktopPort }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Admin Port</span>
            <span class="info-value">{{ connection.adminPort }}</span>
          </div>
        </div>
      </section>

      <!-- Connection Settings -->
      <section class="card">
        <h2 class="section-title">Connection Settings</h2>
        <div class="card-body form-body">
          <label class="field-label">
            Host
            <input v-model="connectionForm.host" class="field-input" placeholder="127.0.0.1" />
          </label>
          <div class="field-grid">
            <label class="field-label">
              Desktop Channel Port
              <input
                v-model.number="connectionForm.desktopPort"
                class="field-input"
                type="number"
                min="1"
                max="65535"
              />
            </label>
            <label class="field-label">
              Admin Port
              <input
                v-model.number="connectionForm.adminPort"
                class="field-input"
                type="number"
                min="1"
                max="65535"
              />
            </label>
          </div>
          <label class="field-label">
            Desktop Token
            <input v-model="connectionForm.token" class="field-input" placeholder="desktop-local" />
          </label>
          <div class="form-actions">
            <button class="save-btn" :disabled="savingConnection" @click="saveConnection">
              {{ savingConnection ? 'Saving…' : 'Save & Reconnect' }}
            </button>
            <button class="secondary-btn" :disabled="savingConnection" @click="resetConnectionForm">
              Reset
            </button>
          </div>
          <p v-if="connectionError" class="error-text">{{ connectionError }}</p>
          <p class="hint">Saved only on this device. Changes take effect after reconnecting.</p>
        </div>
      </section>
    </div>

    <section class="config-section">
      <div class="section-heading">
        <h2>Configuration</h2>
        <p>Adjust runtime options and extension behavior.</p>
      </div>

      <div class="config-grid">
        <ConfigSectionEditor
          section-key="providers"
          title="Providers"
          subtitle="Manage model providers, credentials, and presets."
          :channel-ready="channelReady"
        />
        <ConfigSectionEditor
          section-key="agent"
          title="Agent"
          subtitle="Tune agent behavior and default models."
          :channel-ready="channelReady"
        />
        <ConfigSectionEditor
          section-key="mcp"
          title="MCP"
          subtitle="Manage external tool server connections."
          :channel-ready="channelReady"
        />
        <ConfigSectionEditor
          section-key="channels"
          title="Channels"
          subtitle="Manage channel adapters and runtime options."
          :channel-ready="channelReady"
        />
        <ConfigSectionEditor
          section-key="plugins"
          title="Plugins"
          subtitle="Manage plugins and their options."
          :channel-ready="channelReady"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import {
  DEFAULT_CONNECTION_CONFIG,
  isValidConnectionHost,
  type DesktopConnectionConfig,
} from '../../shared/connection';
import type { ConnectionStatus } from '../../preload/index';
import ConfigSectionEditor from '../components/ConfigSectionEditor.vue';

const status = ref<ConnectionStatus>({ chat: 'disconnected', admin: 'disconnected' });
const connection = ref<DesktopConnectionConfig>({ ...DEFAULT_CONNECTION_CONFIG });
const connectionForm = ref<DesktopConnectionConfig>({ ...connection.value });
const connectionError = ref('');
const savingConnection = ref(false);
let unsubscribeStatus: (() => void) | null = null;
const channelReady = computed(() => status.value.chat === 'connected');

onMounted(async () => {
  status.value = await window.aesyclaw.getStatus();
  connection.value = await window.aesyclaw.getConnectionConfig();
  resetConnectionForm();
  unsubscribeStatus = window.aesyclaw.onStatusChange((s) => {
    status.value = s;
  });
});

onUnmounted(() => {
  unsubscribeStatus?.();
});

function resetConnectionForm(): void {
  connectionForm.value = { ...connection.value };
  connectionError.value = '';
}

async function saveConnection(): Promise<void> {
  connectionError.value = '';
  const normalized = normalizeConnectionForm(connectionForm.value);
  if (!normalized) return;

  savingConnection.value = true;
  try {
    connection.value = await window.aesyclaw.updateConnectionConfig(normalized);
    resetConnectionForm();
  } catch (err) {
    connectionError.value =
      err instanceof Error ? err.message : 'Failed to save connection settings';
  } finally {
    savingConnection.value = false;
  }
}

function normalizeConnectionForm(config: DesktopConnectionConfig): DesktopConnectionConfig | null {
  const host = config.host.trim();
  const token = config.token.trim();
  const desktopPort = Number(config.desktopPort);
  const adminPort = Number(config.adminPort);
  if (!isValidConnectionHost(host)) {
    connectionError.value = 'Host must be a hostname or IP address without scheme, path, or port';
    return null;
  }
  if (!isValidPort(desktopPort) || !isValidPort(adminPort)) {
    connectionError.value = 'Ports must be between 1 and 65535';
    return null;
  }
  if (!token) {
    connectionError.value = 'Desktop token is required';
    return null;
  }
  return { host, desktopPort, adminPort, token };
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

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
  width: min(1120px, 100%);
  padding: 32px 40px 48px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.settings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 20px;
  align-items: start;
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-heading h2 {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-dark);
}

.section-heading p {
  margin: 0.25rem 0 0;
  font-family: var(--font-body);
  font-size: 0.9rem;
  color: var(--color-mid-gray);
}

.config-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 24px;
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

.form-body {
  gap: 14px;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: var(--font-heading);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-dark);
}

.field-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--color-dark);
  font-family: var(--font-body);
  font-size: 14px;
  outline: none;
  transition: border var(--transition-fast);
}
.field-input:focus {
  border-color: var(--color-primary);
}

.form-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.save-btn,
.secondary-btn {
  padding: 9px 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 12px;
  font-weight: 500;
  transition: all var(--transition-fast);
}

.save-btn {
  border: 1px solid var(--color-primary);
  background: var(--color-primary);
  color: #fff;
}
.save-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.secondary-btn {
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-mid-gray);
}
.secondary-btn:hover:not(:disabled) {
  color: var(--color-dark);
  border-color: var(--color-mid-gray);
}
.save-btn:disabled,
.secondary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-text {
  margin: 0;
  color: var(--color-danger);
  font-family: var(--font-body);
  font-size: 13px;
}

/* ── Info rows ───────────────────────── */
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
}
.info-row:last-child {
  border-bottom: none;
}

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
.hint {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-mid-gray);
  margin: 0 0 10px;
  line-height: 1.6;
}
.hint:last-child {
  margin-bottom: 0;
}

@media (max-width: 960px) {
  .settings-view {
    padding: 24px;
  }

  .overview-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .settings-view {
    padding: 20px 16px 32px;
  }

  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
