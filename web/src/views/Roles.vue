<template>
  <div>
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Roles</h2>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Model</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="role in roles"
              :key="role.id"
              class="row-clickable"
              @click="openEditor(role)"
            >
              <td>{{ role.id }}</td>
              <td>{{ role.name }}</td>
              <td>{{ role.model }}</td>
              <td>
                <span class="badge" :class="role.enabled ? 'badge-green' : 'badge-gray'">
                  {{ role.enabled ? 'Yes' : 'No' }}
                </span>
              </td>
            </tr>
            <tr v-if="roles.length === 0">
              <td colspan="4" class="empty-state">No roles</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="editingRole" class="modal-overlay" @click.self="closeEditor">
        <div class="modal" style="max-width: 600px; max-height: 90vh; overflow: auto">
          <h3 class="modal-title">Edit Role: {{ editingRole.id }}</h3>

          <div class="form-group">
            <label>Name</label>
            <input v-model="form.name" class="form-input" />
          </div>

          <div class="form-group">
            <label>Description</label>
            <input v-model="form.description" class="form-input" />
          </div>

          <div class="form-group">
            <label>System Prompt</label>
            <textarea v-model="form.systemPrompt" class="form-textarea" />
          </div>

          <div class="form-group">
            <label>Model</label>
            <input v-model="form.model" class="form-input" />
          </div>

          <div class="form-group">
            <label>Tool Permission Mode</label>
            <select v-model="form.toolPermission.mode" class="form-select">
              <option value="all">all</option>
              <option value="none">none</option>
              <option value="allowlist">allowlist</option>
            </select>
          </div>

          <div v-if="form.toolPermission.mode === 'allowlist'" class="form-group">
            <label>Allowed Tools</label>
            <div v-for="(_t, idx) in form.toolPermission.list" :key="idx" class="array-item">
              <input v-model="form.toolPermission.list![idx]" class="form-input" />
              <button type="button" class="btn btn-danger btn-sm" @click="removeTool(idx)">
                Remove
              </button>
            </div>
            <button type="button" class="btn btn-primary btn-sm" @click="addTool">
              + Add Tool
            </button>
          </div>

          <div class="form-group">
            <label>Skills</label>
            <div v-for="(s, idx) in form.skills" :key="idx" class="array-item">
              <input v-model="form.skills[idx]" class="form-input" />
              <button type="button" class="btn btn-danger btn-sm" @click="removeSkill(idx)">
                Remove
              </button>
            </div>
            <button type="button" class="btn btn-primary btn-sm" @click="addSkill">
              + Add Skill
            </button>
          </div>

          <label
            class="field-label"
            style="
              display: flex;
              align-items: center;
              gap: 0.5rem;
              cursor: pointer;
              margin-bottom: 1rem;
            "
          >
            <input v-model="form.enabled" type="checkbox" />
            Enabled
          </label>

          <div class="modal-actions">
            <button class="btn btn-ghost" @click="closeEditor">Cancel</button>
            <button class="btn btn-success" :disabled="saving" @click="saveRole">
              {{ saving ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <div v-if="toast" class="toast" :class="toast.type">{{ toast.message }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from '@/composables/useAuth';

const { api } = useAuth();

interface ToolPermission {
  mode: 'all' | 'none' | 'allowlist';
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
}

const roles = ref<Role[]>([]);
const editingRole = ref<Role | null>(null);
const form = ref<Role>({
  id: '',
  name: '',
  description: '',
  systemPrompt: '',
  model: '',
  toolPermission: { mode: 'all', list: [] },
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
      roles.value = res.data.data;
    }
  } catch (err) {
    console.error('Failed to load roles', err);
  }
}

function openEditor(role: Role) {
  editingRole.value = role;
  form.value = JSON.parse(JSON.stringify(role));
  if (!form.value.toolPermission) {
    form.value.toolPermission = { mode: 'all', list: [] };
  }
  if (!form.value.skills) {
    form.value.skills = [];
  }
}

function closeEditor() {
  editingRole.value = null;
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
  if (!editingRole.value) return;
  saving.value = true;
  try {
    const payload = { ...form.value };
    delete (payload as Record<string, unknown>).id;
    const res = await api.put(`/roles/${editingRole.value.id}`, payload);
    if (res.data.ok) {
      showToast('toast-success', 'Role saved');
      await loadRoles();
      closeEditor();
    } else {
      showToast('toast-error', res.data.error ?? 'Save failed');
    }
  } catch (err) {
    showToast('toast-error', err instanceof Error ? err.message : 'Save failed');
  } finally {
    saving.value = false;
  }
}

onMounted(loadRoles);
</script>
