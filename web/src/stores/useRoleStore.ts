/**
 * 角色状态管理 Store
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { roleService, type Role, type ToolInfo, type SkillInfo } from '@/services/roleService';

export const useRoleStore = defineStore('role', () => {
  // State
  const roles = ref<Role[]>([]);
  const tools = ref<ToolInfo[]>([]);
  const skills = ref<SkillInfo[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const enabledRoles = computed(() => roles.value.filter((r) => r.enabled === true));
  const disabledRoles = computed(() => roles.value.filter((r) => r.enabled === false));
  const defaultRole = computed(() => roles.value.find((r) => r.id === 'default'));
  
  const getRoleById = computed(() => (roleId: string) => {
    return roles.value.find((r) => r.id === roleId);
  });

  const roleCount = computed(() => roles.value.length);
  const toolCount = computed(() => tools.value.length);
  const skillCount = computed(() => skills.value.length);

  const systemSkills = computed(() => skills.value.filter((s) => s.isSystem === true));
  const userSkills = computed(() => skills.value.filter((s) => s.isSystem === false));

  // Actions
  async function loadRoles() {
    loading.value = true;
    error.value = null;
    try {
      roles.value = await roleService.getRoles();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load roles';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function loadRole(roleId: string) {
    loading.value = true;
    error.value = null;
    try {
      const role = await roleService.getRole(roleId);
      const index = roles.value.findIndex((r) => r.id === roleId);
      if (index >= 0) {
        roles.value[index] = role;
      } else {
        roles.value.push(role);
      }
      return role;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load role';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function createRole(role: Omit<Role, 'id'> & { id?: string }) {
    saving.value = true;
    error.value = null;
    try {
      const newRole = await roleService.createRole(role);
      roles.value.push(newRole);
      return newRole;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create role';
      throw err;
    } finally {
      saving.value = false;
    }
  }

  async function updateRole(roleId: string, updates: Partial<Omit<Role, 'id'>>) {
    saving.value = true;
    error.value = null;
    try {
      await roleService.updateRole(roleId, updates);
      const index = roles.value.findIndex((r) => r.id === roleId);
      if (index >= 0) {
        const currentRole = roles.value[index];
        if (currentRole !== undefined) {
          roles.value[index] = { ...currentRole, ...updates };
        }
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update role';
      throw err;
    } finally {
      saving.value = false;
    }
  }

  async function deleteRole(roleId: string) {
    saving.value = true;
    error.value = null;
    try {
      await roleService.deleteRole(roleId);
      roles.value = roles.value.filter((r) => r.id !== roleId);
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete role';
      throw err;
    } finally {
      saving.value = false;
    }
  }

  async function loadTools() {
    loading.value = true;
    error.value = null;
    try {
      tools.value = await roleService.getTools();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load tools';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function loadSkills() {
    loading.value = true;
    error.value = null;
    try {
      skills.value = await roleService.getSkills();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load skills';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  function clearRoles() {
    roles.value = [];
    tools.value = [];
    skills.value = [];
  }

  // Setup role update listeners
  function setupListeners() {
    roleService.onRoleUpdate((role) => {
      const index = roles.value.findIndex((r) => r.id === role.id);
      if (index >= 0) {
        roles.value[index] = role;
      } else {
        roles.value.push(role);
      }
    });
  }

  // Cleanup listeners
  function cleanupListeners() {
    // Note: We need to store the handler references to properly remove them
    // This is a simplified version - in production, you'd want to store the handlers
  }

  return {
    // State
    roles,
    tools,
    skills,
    loading,
    saving,
    error,

    // Getters
    enabledRoles,
    disabledRoles,
    defaultRole,
    getRoleById,
    roleCount,
    toolCount,
    skillCount,
    systemSkills,
    userSkills,

    // Actions
    loadRoles,
    loadRole,
    createRole,
    updateRole,
    deleteRole,
    loadTools,
    loadSkills,
    clearRoles,
    setupListeners,
    cleanupListeners,
  };
});
