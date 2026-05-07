<template>
  <div>
    <div class="flex items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="page-title">Roles</h1>
        <p class="page-subtitle" style="margin: 0.25rem 0 0">
          Manage roles that control model behavior, tool access, and capabilities.
        </p>
      </div>
      <button
        class="inline-flex items-center justify-center gap-1.5 px-[1.1rem] py-[0.55rem] border border-transparent rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-[#121212] text-white hover:bg-[#2a2a2a] hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(18,18,18,0.25)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none btn-sm"
        @click="openCreate"
      >
        + Add Role
      </button>
    </div>

    <div class="overflow-x-auto rounded border border-[var(--color-border)]">
      <table class="w-full border-collapse separate font-body text-sm">
        <thead>
          <tr>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              ID
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Name
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Model
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Enabled
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(role, idx) in roles"
            :key="role.id"
            class="cursor-pointer bg-[#FDFBF9] transition-colors duration-[0.15s] ease hover:bg-[rgba(20,20,19,0.03)]"
            @click="openEditor(role)"
          >
            <td class="px-4 py-3 border-b border-[var(--color-border)]">{{ idx + 1 }}</td>
            <td class="px-4 py-3 border-b border-[var(--color-border)]">
              <div class="flex flex-col gap-[0.15rem]">
                <span class="font-heading font-medium text-dark">{{ role.id }}</span>
                <span v-if="role.description" class="font-body text-xs text-mid-gray">{{
                  role.description
                }}</span>
              </div>
            </td>
            <td class="px-4 py-3 border-b border-[var(--color-border)]">{{ role.model }}</td>
            <td class="px-4 py-3 border-b border-[var(--color-border)]">
              <span v-if="role.enabled" class="inline-flex items-center justify-center">
                <CheckIcon class="w-4 h-4 text-accent-green stroke-[2.5]" />
              </span>
              <span v-else class="inline-flex items-center justify-center">
                <XMarkIcon class="w-4 h-4 text-danger stroke-[2.5]" />
              </span>
            </td>
          </tr>
          <tr v-if="roles.length === 0">
            <td colspan="4" class="text-mid-gray text-center py-10 font-body italic text-sm">
              No roles
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <Transition name="drawer">
        <div
          v-if="editingRole || creating"
          class="fixed inset-0 bg-[rgba(20,20,19,0.25)] backdrop-blur-sm z-[100] flex justify-end"
          @click.self="closeEditor"
        >
          <div
            class="w-full max-w-[520px] h-full bg-light border-l border-[var(--color-border)] flex flex-col shadow-[-10px_0_30px_rgba(20,20,19,0.08)]"
          >
            <div
              class="flex items-center justify-between px-6 py-5 border-b border-[var(--color-border)] shrink-0"
            >
              <h3 class="font-heading text-lg font-semibold text-dark">
                {{ creating ? 'Add Role' : 'Edit Role' }}
              </h3>
              <button
                class="bg-none border-none cursor-pointer text-mid-gray p-1 flex items-center justify-center rounded transition-all duration-[0.15s] ease hover:bg-light-gray hover:text-dark"
                @click="closeEditor"
              >
                <XMarkIcon class="w-[18px] h-[18px]" />
              </button>
            </div>

            <div class="flex-1 overflow-auto p-6">
              <div class="mb-5">
                <label
                  class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                  >Description</label
                >
                <textarea
                  v-model="form.description"
                  class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)] min-h-[100px] resize-y leading-relaxed"
                  rows="3"
                />
                <div class="text-right font-body text-xs text-mid-gray mt-1">
                  {{ (form.description || '').length }} / 500
                </div>
              </div>

              <div class="flex gap-4 items-end mb-5">
                <div class="flex-1">
                  <label
                    class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                  >
                    Model <span class="text-danger">*</span>
                  </label>
                  <select
                    v-model="form.model"
                    class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                  >
                    <option value="" disabled>Select a model</option>
                    <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                </div>
                <div class="flex flex-col items-start gap-2">
                  <label
                    class="block mb-0 font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                    >Enabled</label
                  >
                  <button
                    type="button"
                    class="w-11 h-6 rounded-full border-none cursor-pointer relative transition-colors duration-[0.15s] ease p-0"
                    :class="form.enabled ? 'bg-accent-green' : 'bg-mid-gray'"
                    @click="form.enabled = !form.enabled"
                  >
                    <span
                      class="absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-transform duration-[0.15s] ease"
                      :class="{ 'translate-x-5': form.enabled }"
                    ></span>
                  </button>
                </div>
              </div>

              <div class="mb-5">
                <label
                  class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                >
                  Tool Permission Mode <span class="text-danger">*</span>
                  <InformationCircleIcon
                    class="inline align-middle ml-1 text-mid-gray w-[14px] h-[14px]"
                  />
                </label>
                <div class="flex gap-3">
                  <label
                    class="flex-1 flex items-start gap-2.5 px-4 py-[0.85rem] border-[1.5px] rounded-sm cursor-pointer transition-all duration-[0.15s] ease bg-light"
                    :class="
                      form.toolPermission.mode === 'allowlist'
                        ? 'border-primary bg-[rgba(217,119,87,0.04)]'
                        : 'border-[var(--color-border)] hover:border-mid-gray'
                    "
                  >
                    <input
                      v-model="form.toolPermission.mode"
                      type="radio"
                      value="allowlist"
                      class="absolute opacity-0 pointer-events-none"
                    />
                    <span
                      class="w-4 h-4 rounded-full border-2 border-mid-gray flex items-center justify-center shrink-0 mt-[0.1rem] transition-all duration-[0.15s] ease"
                      :class="{ '!border-primary': form.toolPermission.mode === 'allowlist' }"
                    >
                      <span
                        class="w-2 h-2 rounded-full bg-primary scale-0 transition-transform duration-[0.15s] ease"
                        :class="{ 'scale-100': form.toolPermission.mode === 'allowlist' }"
                      ></span>
                    </span>
                    <div class="flex flex-col gap-[0.2rem]">
                      <span class="font-heading text-sm font-medium text-dark">Allowlist</span>
                      <span class="font-body text-xs text-mid-gray leading-[1.3]"
                        >Only allow the tools listed below.</span
                      >
                    </div>
                  </label>
                  <label
                    class="flex-1 flex items-start gap-2.5 px-4 py-[0.85rem] border-[1.5px] rounded-sm cursor-pointer transition-all duration-[0.15s] ease bg-light"
                    :class="
                      form.toolPermission.mode === 'denylist'
                        ? 'border-primary bg-[rgba(217,119,87,0.04)]'
                        : 'border-[var(--color-border)] hover:border-mid-gray'
                    "
                  >
                    <input
                      v-model="form.toolPermission.mode"
                      type="radio"
                      value="denylist"
                      class="absolute opacity-0 pointer-events-none"
                    />
                    <span
                      class="w-4 h-4 rounded-full border-2 border-mid-gray flex items-center justify-center shrink-0 mt-[0.1rem] transition-all duration-[0.15s] ease"
                      :class="{ '!border-primary': form.toolPermission.mode === 'denylist' }"
                    >
                      <span
                        class="w-2 h-2 rounded-full bg-primary scale-0 transition-transform duration-[0.15s] ease"
                        :class="{ 'scale-100': form.toolPermission.mode === 'denylist' }"
                      ></span>
                    </span>
                    <div class="flex flex-col gap-[0.2rem]">
                      <span class="font-heading text-sm font-medium text-dark">Denylist</span>
                      <span class="font-body text-xs text-mid-gray leading-[1.3]"
                        >Deny the tools listed below. All others are allowed.</span
                      >
                    </div>
                  </label>
                </div>
              </div>

              <div class="mb-5">
                <div class="flex items-center justify-between mb-2">
                  <label
                    class="block mb-0 font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                  >
                    {{
                      form.toolPermission.mode === 'allowlist' ? 'Allowed Tools' : 'Denied Tools'
                    }}
                    <InformationCircleIcon
                      class="inline align-middle ml-1 text-mid-gray w-[14px] h-[14px]"
                    />
                  </label>
                  <button
                    type="button"
                    class="inline-flex items-center gap-[0.3rem] px-[0.7rem] py-[0.35rem] border border-transparent rounded-sm bg-[#121212] text-white font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease hover:bg-[#2a2a2a]"
                    @click="addTool"
                  >
                    <PlusIcon class="w-3 h-3 stroke-[2.5]" />
                    Add Tool
                  </button>
                </div>
                <div class="flex flex-col gap-[0.35rem]">
                  <div
                    v-for="(t, idx) in form.toolPermission.list"
                    :key="`tool-${idx}`"
                    class="flex items-center gap-2 px-[0.6rem] py-[0.5rem] border border-[var(--color-border)] rounded-sm bg-light transition-colors duration-[0.15s] ease hover:border-mid-gray"
                  >
                    <Bars3Icon class="w-3 h-3 text-mid-gray shrink-0" />
                    <input
                      v-model="(form.toolPermission.list || [])[idx]"
                      class="flex-1 border-none bg-none font-body text-sm text-dark outline-none p-0"
                    />
                    <button
                      type="button"
                      class="bg-none border-none cursor-pointer text-mid-gray p-[0.15rem] flex items-center justify-center rounded transition-all duration-[0.15s] ease shrink-0 hover:text-danger hover:bg-[rgba(196,91,91,0.08)]"
                      @click="removeTool(idx)"
                    >
                      <XMarkIcon class="w-[14px] h-[14px]" />
                    </button>
                  </div>
                </div>
              </div>

              <div class="mb-5">
                <div class="flex items-center justify-between mb-2">
                  <label
                    class="block mb-0 font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                  >
                    Skills
                    <InformationCircleIcon
                      class="inline align-middle ml-1 text-mid-gray w-[14px] h-[14px]"
                    />
                  </label>
                  <button
                    type="button"
                    class="inline-flex items-center gap-[0.3rem] px-[0.7rem] py-[0.35rem] border border-transparent rounded-sm bg-[#121212] text-white font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease hover:bg-[#2a2a2a]"
                    @click="addSkill"
                  >
                    <PlusIcon class="w-3 h-3 stroke-[2.5]" />
                    Add Skill
                  </button>
                </div>
                <div class="flex flex-col gap-[0.35rem]">
                  <div
                    v-for="(s, idx) in form.skills"
                    :key="`skill-${idx}`"
                    class="flex items-center gap-2 px-[0.6rem] py-[0.5rem] border border-[var(--color-border)] rounded-sm bg-light transition-colors duration-[0.15s] ease hover:border-mid-gray"
                  >
                    <Bars3Icon class="w-3 h-3 text-mid-gray shrink-0" />
                    <input
                      v-model="form.skills[idx]"
                      class="flex-1 border-none bg-none font-body text-sm text-dark outline-none p-0"
                    />
                    <button
                      type="button"
                      class="bg-none border-none cursor-pointer text-mid-gray p-[0.15rem] flex items-center justify-center rounded transition-all duration-[0.15s] ease shrink-0 hover:text-danger hover:bg-[rgba(196,91,91,0.08)]"
                      @click="removeSkill(idx)"
                    >
                      <XMarkIcon class="w-[14px] h-[14px]" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div
              class="flex justify-end gap-2.5 px-6 py-4 border-t border-[var(--color-border)] shrink-0"
            >
              <button
                class="inline-flex items-center justify-center gap-1.5 px-[1.1rem] py-[0.55rem] border border-[var(--color-border)] rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-transparent text-mid-gray hover:bg-light-gray hover:text-dark hover:border-mid-gray"
                @click="closeEditor"
              >
                Cancel
              </button>
              <button
                class="inline-flex items-center justify-center gap-1.5 px-[1.1rem] py-[0.55rem] border border-primary rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-primary text-white hover:bg-primary-hover hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(217,119,87,0.25)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                :disabled="saving"
                @click="saveRole"
              >
                {{ saving ? 'Saving...' : 'Save Changes' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useWebSocket } from '@/composables/useWebSocket';
import { useToast } from '@/composables/useToast';
import {
  CheckIcon,
  XMarkIcon,
  InformationCircleIcon,
  PlusIcon,
  Bars3Icon,
} from '@heroicons/vue/24/outline';
import type { Role, ToolPermission } from '@/types/api';

const ws = useWebSocket();
const { showToast } = useToast();

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
  description: '',
  systemPrompt: '',
  model: '',
  toolPermission: { mode: 'allowlist', list: [] },
  skills: [],
  enabled: true,
});
const saving = ref(false);

async function loadRoles() {
  try {
    const data = await ws.send('get_roles');
    roles.value = Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Failed to load roles', err);
  }
}

async function loadModelOptions() {
  try {
    const config = await ws.send('get_config') as Record<string, unknown>;
    const providers = config['providers'] as Record<
      string,
      { models?: Record<string, unknown> }
    > | undefined;
    const opts: ModelOption[] = [];
    if (providers) {
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
    }
    modelOptions.value = opts;
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
    const formData = { ...form.value };
    const { id: _excluded, ...payload } = formData;

    if (creating.value) {
      await ws.send('create_role', payload);
      showToast('toast-success', 'Role created');
      await loadRoles();
      closeEditor();
    } else if (editingRole.value) {
      await ws.send('update_role', { id: editingRole.value.id, ...payload });
      showToast('toast-success', 'Role saved');
      await loadRoles();
      closeEditor();
    }
  } catch (err) {
    showToast('toast-error', err instanceof Error ? err.message : 'Save failed');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadRoles();
  loadModelOptions();
});
</script>
