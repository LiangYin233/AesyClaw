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

export class RoleService {
  /**
   * 获取角色列表
   */
  async getRoles(): Promise<Role[]> {
    return apiClient.request<Role[]>('get_roles');
  }

  /**
   * 获取角色详情
   */
  async getRole(roleId: string): Promise<Role> {
    return apiClient.request<Role>('get_role', { roleId });
  }

  /**
   * 创建角色
   */
  async createRole(role: Omit<Role, 'id'> & { id?: string }): Promise<Role> {
    return apiClient.request<Role>('create_role', role);
  }

  /**
   * 更新角色
   */
  async updateRole(roleId: string, role: Partial<Role>): Promise<void> {
    await apiClient.request('update_role', { id: roleId, ...role });
  }

  /**
   * 删除角色
   */
  async deleteRole(roleId: string): Promise<void> {
    await apiClient.request('delete_role', { id: roleId });
  }

  /**
   * 获取可用工具列表
   */
  async getTools(): Promise<ToolInfo[]> {
    return apiClient.request<ToolInfo[]>('get_tools');
  }

  /**
   * 获取可用技能列表
   */
  async getSkills(): Promise<SkillInfo[]> {
    return apiClient.request<SkillInfo[]>('get_skills');
  }

  /**
   * 监听角色更新
   */
  onRoleUpdate(handler: (role: Role) => void): void {
    apiClient.on('role_update', (data: unknown) => handler(data as Role));
  }

  /**
   * 移除角色更新监听器
   */
  offRoleUpdate(handler: (role: Role) => void): void {
    apiClient.off('role_update', (data: unknown) => handler(data as Role));
  }
}

export const roleService = new RoleService();
