/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useWebSocket } from '@/composables/useWebSocket';
import { useToast } from '@/composables/useToast';
import type { Role, ToolPermission } from '@/types/api';
import {
  CheckIcon,
  XMarkIcon,
  InformationCircleIcon,
  ChevronUpDownIcon,
  TrashIcon,
} from '@heroicons/vue/24/outline';

interface ModelOption {
  value: string;
  label: string;
}

interface ToolInfo {
  name: string;
  description: string;
  owner: string;
}

interface SkillInfo {
  name: string;
  description: string;
  isSystem: boolean;
}

export function useRolesEditor() {
  const ws = useWebSocket();
  const { showToast } = useToast();

  const roles = ref<Role[]>([]);
  const editingRole = ref<Role | null>(null);
  const creating = ref(false);
  const modelOptions = ref<ModelOption[]>([]);
  const allTools = ref<ToolInfo[]>([]);
  const toolDropdownOpen = ref(false);
  const toolSearch = ref('');
  const toolDropdownRef = ref<HTMLElement | null>(null);
  const allSkills = ref<SkillInfo[]>([]);
  const skillDropdownOpen = ref(false);
  const skillSearch = ref('');
  const skillDropdownRef = ref<HTMLElement | null>(null);
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

  async function loadRoles(): Promise<void> {
    try {
      const data = await ws.send('get_roles');
      roles.value = Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('Failed to load roles', err);
    }
  }

  async function loadModelOptions(): Promise<void> {
    try {
      const config = (await ws.send('get_config')) as Record<string, unknown>;
      const providers = config['providers'] as
        | Record<string, { models?: Record<string, unknown> }>
        | undefined;
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

  async function loadTools(): Promise<void> {
    if (allTools.value.length > 0) return;
    try {
      const data = await ws.send('get_tools');
      allTools.value = Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('Failed to load tools', err);
    }
  }

  async function loadSkills(): Promise<void> {
    if (allSkills.value.length > 0) return;
    try {
      const data = await ws.send('get_skills');
      allSkills.value = Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('Failed to load skills', err);
    }
  }

  function openEditor(role: Role): void {
    creating.value = false;
    editingRole.value = role;
    void loadTools();
    void loadSkills();
    form.value = JSON.parse(JSON.stringify(role));
    if (!form.value.toolPermission) {
      form.value.toolPermission = { mode: 'allowlist', list: [] };
    } else if (!isValidToolPermissionMode(form.value.toolPermission.mode)) {
      form.value.toolPermission.mode = 'allowlist';
    }
    form.value.toolPermission.list ??= [];
    form.value.skills ??= [];
  }

  function openCreate(): void {
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
    void loadTools();
    void loadSkills();
  }

  function isValidToolPermissionMode(mode: string): mode is ToolPermission['mode'] {
    return mode === 'allowlist' || mode === 'denylist';
  }

  const filteredTools = computed(() => {
    const q = toolSearch.value.toLowerCase();
    return allTools.value.filter((t) => !q || t.name.toLowerCase().includes(q));
  });

  const isWildcard = computed(
    () => form.value.toolPermission.list?.length === 1 && form.value.toolPermission.list[0] === '*',
  );

  const toolSelectionLabel = computed(() => {
    if (isWildcard.value) return 'All tools (*)';
    const n = form.value.toolPermission.list?.length ?? 0;
    return n === 0 ? 'Select tools' : `${n} tool${n > 1 ? 's' : ''} selected`;
  });

  const filteredSkills = computed(() => {
    const q = skillSearch.value.toLowerCase();
    return allSkills.value.filter((s) => !q || s.name.toLowerCase().includes(q));
  });

  const isSkillWildcard = computed(
    () => form.value.skills?.length === 1 && form.value.skills[0] === '*',
  );

  const allSelectedSkillNames = computed(() => {
    const names = new Set(allSkills.value.filter((s) => s.isSystem).map((s) => s.name));
    for (const name of form.value.skills ?? []) names.add(name);
    return names;
  });

  const skillSelectionLabel = computed(() => {
    if (isSkillWildcard.value) return 'All skills (*)';
    const total = allSelectedSkillNames.value.size;
    const systemCount = allSkills.value.filter((s) => s.isSystem).length;
    if (total === 0) return 'Select skills';
    let label = `${total} skill${total > 1 ? 's' : ''} selected`;
    if (systemCount > 0) label += ` (${systemCount} system)`;
    return label;
  });

  function isToolSelected(name: string): boolean {
    return form.value.toolPermission.list?.includes(name) ?? false;
  }

  function toggleTool(name: string): void {
    form.value.toolPermission.list ??= [];
    const idx = form.value.toolPermission.list.indexOf(name);
    if (idx >= 0) {
      form.value.toolPermission.list.splice(idx, 1);
    } else {
      form.value.toolPermission.list.push(name);
    }
  }

  function selectAllTools(): void {
    form.value.toolPermission.list = ['*'];
  }

  function clearAllTools(): void {
    form.value.toolPermission.list = [];
  }

  function toggleToolDropdown(): void {
    toolDropdownOpen.value = !toolDropdownOpen.value;
    if (toolDropdownOpen.value) toolSearch.value = '';
  }

  function closeToolDropdown(): void {
    toolDropdownOpen.value = false;
  }

  function isSkillSelected(name: string): boolean {
    const skill = allSkills.value.find((s) => s.name === name);
    if (skill?.isSystem) return true;
    return form.value.skills?.includes(name) ?? false;
  }

  function toggleSkill(name: string): void {
    const skill = allSkills.value.find((s) => s.name === name);
    if (skill?.isSystem) return;
    form.value.skills ??= [];
    const idx = form.value.skills.indexOf(name);
    if (idx >= 0) {
      form.value.skills.splice(idx, 1);
    } else {
      form.value.skills.push(name);
    }
  }

  function selectAllSkills(): void {
    form.value.skills = ['*'];
  }

  function clearAllSkills(): void {
    form.value.skills = [];
  }

  function toggleSkillDropdown(): void {
    skillDropdownOpen.value = !skillDropdownOpen.value;
    if (skillDropdownOpen.value) skillSearch.value = '';
  }

  function closeSkillDropdown(): void {
    skillDropdownOpen.value = false;
  }

  function handleClickOutside(e: MouseEvent): void {
    const toolEl = toolDropdownRef.value;
    if (toolDropdownOpen.value && toolEl && !toolEl.contains(e.target as Node)) {
      closeToolDropdown();
    }
    const skillEl = skillDropdownRef.value;
    if (skillDropdownOpen.value && skillEl && !skillEl.contains(e.target as Node)) {
      closeSkillDropdown();
    }
  }

  function closeEditor(): void {
    editingRole.value = null;
    creating.value = false;
  }

  async function saveRole(): Promise<void> {
    saving.value = true;
    try {
      const formData = { ...form.value };
      const { id: formId, ...payload } = formData;

      if (creating.value) {
        await ws.send('create_role', formId.trim() ? { ...payload, id: formId.trim() } : payload);
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

  async function deleteRole(role: Role): Promise<void> {
    if (!confirm(`Delete role "${role.id}"?`)) return;
    try {
      await ws.send('delete_role', { id: role.id });
      showToast('toast-success', 'Role deleted');
      if (editingRole.value?.id === role.id) closeEditor();
      await loadRoles();
    } catch (err) {
      showToast('toast-error', err instanceof Error ? err.message : 'Delete failed');
    }
  }

  onMounted(() => {
    void loadRoles();
    void loadModelOptions();
    document.addEventListener('click', handleClickOutside);
  });

  onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside);
  });

  return {
    roles,
    editingRole,
    creating,
    modelOptions,
    allTools,
    toolDropdownOpen,
    toolSearch,
    toolDropdownRef,
    allSkills,
    skillDropdownOpen,
    skillSearch,
    skillDropdownRef,
    form,
    saving,
    openEditor,
    openCreate,
    isValidToolPermissionMode,
    filteredTools,
    isWildcard,
    toolSelectionLabel,
    filteredSkills,
    isSkillWildcard,
    allSelectedSkillNames,
    skillSelectionLabel,
    isToolSelected,
    toggleTool,
    selectAllTools,
    clearAllTools,
    toggleToolDropdown,
    closeToolDropdown,
    isSkillSelected,
    toggleSkill,
    selectAllSkills,
    clearAllSkills,
    toggleSkillDropdown,
    closeSkillDropdown,
    handleClickOutside,
    closeEditor,
    saveRole,
    deleteRole,
    CheckIcon,
    XMarkIcon,
    InformationCircleIcon,
    ChevronUpDownIcon,
    TrashIcon,
  };
}
