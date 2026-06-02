/**
 * 角色相关 API 服务
 */

import { apiClient } from './api';

export interface ToolPermission {
  mode: 'allowlist' | 'denylist';
  list: string[];
}

export interface Role {
  id: string;
  description: string;
  systemPrompt: string;
  toolPermission: ToolPermission;
  skills: string[];
  enabled: boolean;
}

export interface ToolInfo {
  name: string;
  description: string;
  owner: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  isSystem: boolean;
}

export const roleService = {
  getRoles(): Promise<Role[]> {
    return apiClient.request<Role[]>('get_roles');
  },

  getRole(roleId: string): Promise<Role> {
    return apiClient.request<Role>('get_role', { roleId });
  },

  createRole(role: Omit<Role, 'id'> & { id?: string }): Promise<Role> {
    return apiClient.request<Role>('create_role', role);
  },

  async updateRole(roleId: string, role: Partial<Role>): Promise<void> {
    await apiClient.request('update_role', { id: roleId, ...role });
  },

  async deleteRole(roleId: string): Promise<void> {
    await apiClient.request('delete_role', { id: roleId });
  },

  getTools(): Promise<ToolInfo[]> {
    return apiClient.request<ToolInfo[]>('get_tools');
  },

  getSkills(): Promise<SkillInfo[]> {
    return apiClient.request<SkillInfo[]>('get_skills');
  },

  onRoleUpdate(handler: (role: Role) => void): void {
    apiClient.on('role_update', (data: unknown) => handler(data as Role));
  },

  offRoleUpdate(handler: (role: Role) => void): void {
    apiClient.off('role_update', (data: unknown) => handler(data as Role));
  },
};
