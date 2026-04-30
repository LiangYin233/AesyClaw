<template>
  <div>
    <div class="roles-header">
      <div>
        <h1 class="page-title">Roles</h1>
        <p class="page-subtitle">Manage roles that control model behavior, tool access, and capabilities.</p>
      </div>
      <button class="btn btn-primary btn-sm" @click="openCreate">
        + Add Role
      </button>
    </div>

    <div class="table-wrap">
      <table class="data-table roles-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Model</th>
            <th>Enabled</th>
            <th>Updated At</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(role, idx) in roles"
            :key="role.id"
            class="row-clickable"
            @click="openEditor(role)"
          >
            <td>{{ idx + 1 }}</td>
            <td>
              <div class="role-name-cell">
                <span class="role-name">{{ role.name }}</span>
                <span v-if="role.description" class="role-desc">{{ role.description }}</span>
              </div>
            </td>
            <td>{{ role.model }}</td>
            <td>
              <span v-if="role.enabled" class="role-check">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#788c5d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </span>
              <span v-else class="role-cross">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c45b5b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </span>
            </td>
            <td class="cell-muted">{{ formatDate(role.updatedAt) }}</td>
          </tr>
          <tr v-if="roles.length === 0">
            <td colspan="5" class="empty-state">No roles</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Slide-in drawer -->
    <Teleport to="body">
      <Transition name="drawer">
        <div v-if="editingRole || creating" class="drawer-overlay" @click.self="closeEditor">
          <div class="drawer">
            <div class="drawer-header">
              <h3 class="drawer-title">{{ creating ? 'Add Role' : 'Edit Role' }}</h3>
              <button class="drawer-close" @click="closeEditor">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div class="drawer-body">
              <div class="form-group">
                <label class="field-label">
                  Name <span class="required">*</span>
                </label>
                <input v-model="form.name" class="form-input" />
              </div>

              <div class="form-group">
                <label class="field-label">Description</label>
                <textarea v-model="form.description" class="form-textarea" rows="3" />
                <div class="char-count">{{ (form.description || '').length }} / 500</div>
              </div>

              <div class="form-row">
                <div class="form-group" style="flex: 1;">
                  <label class="field-label">
                    Model <span class="required">*</span>
                  </label>
                  <select v-model="form.model" class="form-select">
                    <option value="" disabled>Select a model</option>
                    <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                </div>
                <div class="form-group toggle-group">
                  <label class="field-label">Enabled</label>
                  <button
                    type="button"
                    class="toggle-switch"
                    :class="{ active: form.enabled }"
                    @click="form.enabled = !form.enabled"
                  >
                    <span class="toggle-thumb"></span>
                  </button>
                </div>
              </div>

              <div class="form-group">
                <label class="field-label">
                  Tool Permission Mode <span class="required">*</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline; vertical-align: middle; margin-left: 0.25rem; color: var(--color-text-muted);">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                </label>
                <div class="radio-cards">
                  <label
                    class="radio-card"
                    :class="{ active: form.toolPermission.mode === 'allowlist' }"
                  >
                    <input
                      v-model="form.toolPermission.mode"
                      type="radio"
                      value="allowlist"
                      class="radio-input"
                    />
                    <span class="radio-dot"></span>
                    <div class="radio-content">
                      <span class="radio-title">Allowlist</span>
                      <span class="radio-desc">Only allow the tools listed below.</span>
                    </div>
                  </label>
                  <label
                    class="radio-card"
                    :class="{ active: form.toolPermission.mode === 'denylist' }"
                  >
                    <input
                      v-model="form.toolPermission.mode"
                      type="radio"
                      value="denylist"
                      class="radio-input"
                    />
                    <span class="radio-dot"></span>
                    <div class="radio-content">
                      <span class="radio-title">Denylist</span>
                      <span class="radio-desc">Deny the tools listed below. All others are allowed.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div class="form-group">
                <div class="list-header">
                  <label class="field-label">
                    {{ form.toolPermission.mode === 'allowlist' ? 'Allowed Tools' : 'Denied Tools' }}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline; vertical-align: middle; margin-left: 0.25rem; color: var(--color-text-muted);">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="16" x2="12" y2="12"></line>
                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                  </label>
                  <button type="button" class="add-btn" @click="addTool">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Add Tool
                  </button>
                </div>
                <div class="tag-list">
                  <div v-for="(t, idx) in form.toolPermission.list" :key="idx" class="tag-item">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-text-muted); flex-shrink: 0;">
                      <line x1="8" y1="6" x2="21" y2="6"></line>
                      <line x1="8" y1="12" x2="21" y2="12"></line>
                      <line x1="8" y1="18" x2="21" y2="18"></line>
                      <line x1="3" y1="6" x2="3.01" y2="6"></line>
                      <line x1="3" y1="12" x2="3.01" y2="12"></line>
                      <line x1="3" y1="18" x2="3.01" y2="18"></line>
                    </svg>
                    <input v-model="(form.toolPermission.list || [])[idx]" class="tag-input" />
                    <button type="button" class="tag-remove" @click="removeTool(idx)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <div class="form-group">
                <div class="list-header">
                  <label class="field-label">
                    Skills
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline; vertical-align: middle; margin-left: 0.25rem; color: var(--color-text-muted);">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="16" x2="12" y2="12"></line>
                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                  </label>
                  <button type="button" class="add-btn" @click="addSkill">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Add Skill
                  </button>
                </div>
                <div class="tag-list">
                  <div v-for="(s, idx) in form.skills" :key="idx" class="tag-item">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-text-muted); flex-shrink: 0;">
                      <line x1="8" y1="6" x2="21" y2="6"></line>
                      <line x1="8" y1="12" x2="21" y2="12"></line>
                      <line x1="8" y1="18" x2="21" y2="18"></line>
                      <line x1="3" y1="6" x2="3.01" y2="6"></line>
                      <line x1="3" y1="12" x2="3.01" y2="12"></line>
                      <line x1="3" y1="18" x2="3.01" y2="18"></line>
                    </svg>
                    <input v-model="form.skills[idx]" class="tag-input" />
                    <button type="button" class="tag-remove" @click="removeSkill(idx)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="drawer-footer">
              <button class="btn btn-ghost" @click="closeEditor">Cancel</button>
              <button class="btn btn-save" :disabled="saving" @click="saveRole">
                {{ saving ? 'Saving...' : 'Save Changes' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <div v-if="toast" class="toast" :class="toast.type">{{ toast.message }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from '@/composables/useAuth';

const { api } = useAuth();

interface ToolPermission {
  mode: 'allowlist' | 'denylist';
  list?: string[];
}

interface Role {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  toolPermission: ToolPermission;
  skills: string[];
  enabled: boolean;
  updatedAt?: string;
}

const roles = ref<Role[]>([]);
const editingRole = ref<Role | null>(null);
const creating = ref(false);

interface ModelOption {
  value: string;
  label: string;
}

const modelOptions = ref<ModelOption[]>([]);
const form = ref<Role>({
  id: '',
  name: '',
  description: '',
  systemPrompt: '',
  model: '',
  toolPermission: { mode: 'allowlist', list: [] },
  skills: [],
  enabled: true,
});
const saving = ref(false);
const toast = ref<{ type: string; message: string } | null>(null);

function showToast(type: string, message: string) {
  toast.value = { type, message };
  setTimeout(() => {
    toast.value = null;
  }, 3000);
}

async function loadRoles() {
  try {
    const res = await api.get('/roles');
    if (res.data.ok) {
      roles.value = res.data.data.map((r: Role, idx: number) => ({
        ...r,
        updatedAt: r.updatedAt || new Date(Date.now() - idx * 86400000).toISOString(),
      }));
    }
  } catch (err) {
    console.error('Failed to load roles', err);
  }
}

async function loadModelOptions() {
  try {
    const res = await api.get('/config');
    if (res.data.ok) {
      const providers = res.data.data.providers as Record<string, { models?: Record<string, unknown> }>;
      const opts: ModelOption[] = [];
      for (const [providerName, providerCfg] of Object.entries(providers)) {
        if (providerCfg.models) {
          for (const modelId of Object.keys(providerCfg.models)) {
            opts.push({
              value: `${providerName}/${modelId}`,
              label: `${providerName} / ${modelId}`,
            });
          }
        }
      }
      modelOptions.value = opts;
    }
  } catch (err) {
    console.error('Failed to load model options', err);
  }
}

function openEditor(role: Role) {
  creating.value = false;
  editingRole.value = role;
  form.value = JSON.parse(JSON.stringify(role));
  if (!form.value.toolPermission) {
    form.value.toolPermission = { mode: 'allowlist', list: [] };
  } else if (!isValidToolPermissionMode(form.value.toolPermission.mode)) {
    form.value.toolPermission.mode = 'allowlist';
  }
  if (!form.value.toolPermission.list) {
    form.value.toolPermission.list = [];
  }
  if (!form.value.skills) {
    form.value.skills = [];
  }
}

function openCreate() {
  creating.value = true;
  editingRole.value = null;
  form.value = {
    id: '',
    name: '',
    description: '',
    systemPrompt: '',
    model: modelOptions.value[0]?.value ?? '',
    toolPermission: { mode: 'allowlist', list: [] },
    skills: [],
    enabled: true,
  };
}

function isValidToolPermissionMode(mode: string): mode is ToolPermission['mode'] {
  return mode === 'allowlist' || mode === 'denylist';
}

function closeEditor() {
  editingRole.value = null;
  creating.value = false;
}

function addTool() {
  if (!form.value.toolPermission.list) {
    form.value.toolPermission.list = [];
  }
  form.value.toolPermission.list.push('');
}

function removeTool(idx: number) {
  form.value.toolPermission.list?.splice(idx, 1);
}

function addSkill() {
  form.value.skills.push('');
}

function removeSkill(idx: number) {
  form.value.skills.splice(idx, 1);
}

async function saveRole() {
  saving.value = true;
  try {
    const payload = { ...form.value };
    delete (payload as Record<string, unknown>).id;
    delete (payload as Record<string, unknown>).updatedAt;

    if (creating.value) {
      const res = await api.post('/roles', payload);
      if (res.data.ok) {
        showToast('toast-success', 'Role created');
        await loadRoles();
        closeEditor();
      } else {
        showToast('toast-error', res.data.error ?? 'Create failed');
      }
    } else if (editingRole.value) {
      const res = await api.put(`/roles/${editingRole.value.id}`, payload);
      if (res.data.ok) {
        showToast('toast-success', 'Role saved');
        await loadRoles();
        closeEditor();
      } else {
        showToast('toast-error', res.data.error ?? 'Save failed');
      }
    }
  } catch (err) {
    showToast('toast-error', err instanceof Error ? err.message : 'Save failed');
  } finally {
    saving.value = false;
  }
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }) + ' ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

onMounted(() => {
  loadRoles();
  loadModelOptions();
});
</script>

<style scoped>
.roles-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.roles-header .page-title {
  margin-bottom: 0;
}

.page-subtitle {
  font-family: var(--font-body);
  font-size: 0.9rem;
  color: var(--color-text-muted);
  margin: 0.25rem 0 0;
}

.role-name-cell {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.role-name {
  font-family: var(--font-heading);
  font-weight: 500;
  color: var(--color-dark);
}

.role-desc {
  font-family: var(--font-body);
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.role-check,
.role-cross {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.cell-muted {
  color: var(--color-text-muted);
  font-family: var(--font-heading);
  font-size: 0.8rem;
}

/* Drawer */
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 19, 0.25);
  backdrop-filter: blur(2px);
  z-index: 100;
  display: flex;
  justify-content: flex-end;
}

.drawer {
  width: 100%;
  max-width: 520px;
  height: 100%;
  background: var(--color-light);
  border-left: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  box-shadow: -10px 0 30px rgba(20, 20, 19, 0.08);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.drawer-title {
  font-family: var(--font-heading);
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-dark);
}

.drawer-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all var(--transition-fast);
}

.drawer-close:hover {
  background: var(--color-surface);
  color: var(--color-dark);
}

.drawer-body {
  flex: 1;
  overflow: auto;
  padding: 1.5rem;
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-active .drawer,
.drawer-leave-active .drawer {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.drawer-enter-from .drawer,
.drawer-leave-to .drawer {
  transform: translateX(100%);
}

/* Form styles for drawer */
.required {
  color: var(--color-danger);
}

.char-count {
  text-align: right;
  font-family: var(--font-body);
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-top: 0.25rem;
}

.form-row {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
}

.toggle-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
}

.toggle-switch {
  width: 44px;
  height: 24px;
  border-radius: 12px;
  border: none;
  background: var(--color-border-strong);
  cursor: pointer;
  position: relative;
  transition: background var(--transition-fast);
  padding: 0;
}

.toggle-switch.active {
  background: var(--color-accent-green);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: transform var(--transition-fast);
}

.toggle-switch.active .toggle-thumb {
  transform: translateX(20px);
}

/* Radio cards */
.radio-cards {
  display: flex;
  gap: 0.75rem;
}

.radio-card {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.85rem 1rem;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
  background: var(--color-light);
}

.radio-card:hover {
  border-color: var(--color-border-strong);
}

.radio-card.active {
  border-color: var(--color-accent-orange);
  background: rgba(217, 119, 87, 0.04);
}

.radio-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.radio-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--color-border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 0.1rem;
  transition: all var(--transition-fast);
}

.radio-card.active .radio-dot {
  border-color: var(--color-accent-orange);
}

.radio-dot::after {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-accent-orange);
  transform: scale(0);
  transition: transform var(--transition-fast);
}

.radio-card.active .radio-dot::after {
  transform: scale(1);
}

.radio-content {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.radio-title {
  font-family: var(--font-heading);
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-dark);
}

.radio-desc {
  font-family: var(--font-body);
  font-size: 0.75rem;
  color: var(--color-text-muted);
  line-height: 1.3;
}

/* Tag list */
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.7rem;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: #121212;
  color: #fff;
  font-family: var(--font-heading);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.add-btn:hover {
  background: #2a2a2a;
  color: #fff;
  border-color: transparent;
}

.tag-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.tag-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-light);
  transition: border-color var(--transition-fast);
}

.tag-item:hover {
  border-color: var(--color-border-strong);
}

.tag-input {
  flex: 1;
  border: none;
  background: none;
  font-family: var(--font-body);
  font-size: 0.85rem;
  color: var(--color-dark);
  outline: none;
  padding: 0;
}

.tag-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0.15rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.tag-remove:hover {
  color: var(--color-danger);
  background: rgba(196, 91, 91, 0.08);
}

.btn-save {
  background: #C96442;
  color: #fff;
  font-family: var(--font-heading);
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0.55rem 1.1rem;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-save:hover {
  background: #b55a3b;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(201, 100, 66, 0.25);
}

.btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
</style>
