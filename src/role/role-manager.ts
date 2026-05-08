import { randomUUID } from 'node:crypto';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { RoleConfig } from '@aesyclaw/core/types';
import type { RoleStore } from './role-store';

const logger = createScopedLogger('role');

export class RoleManager {
  constructor(private roleStore: RoleStore) {}

  async initialize(): Promise<void> {
    logger.info(`已加载 ${this.getAllRoles().length} 个角色`);
  }

  destroy(): void {
    // no-op — RoleStore 生命周期由 Application 管理
  }

  getRole(roleId: string): RoleConfig {
    const role = this.getAllRoles().find((candidate) => candidate.id === roleId);
    if (role) return role;
    logger.warn(`未找到角色 "${roleId}" — 回退到默认角色`);
    return this.getDefaultRole();
  }

  getDefaultRole(): RoleConfig {
    const roles = this.getAllRoles();
    const defaultRole = roles.find((role) => role.id === 'default');
    if (defaultRole) return defaultRole;

    const firstEnabled = roles.find((role) => role.enabled);
    if (firstEnabled !== undefined) return firstEnabled;

    throw new Error('没有可用角色 — 必须至少定义一个角色');
  }

  getEnabledRoles(): RoleConfig[] {
    return this.getAllRoles().filter((role) => role.enabled);
  }

  getAllRoles(): RoleConfig[] {
    return [...this.roleStore.getRoles()];
  }

  async saveRole(roleId: string, roleData: RoleConfig): Promise<void> {
    const roles = this.getAllRoles();
    const existing = roles.find((role) => role.id === roleId);
    if (!existing) {
      throw new Error(`未找到角色 "${roleId}"`);
    }

    const updatedRoles = roles.map((role) => (role.id === roleId ? roleData : role));
    await this.roleStore.setRoles(updatedRoles);
    logger.info('角色已保存', { roleId });
  }

  async createRole(roleData: Omit<RoleConfig, 'id'> & { id?: string }): Promise<RoleConfig> {
    const id = roleData.id ?? randomUUID();
    const roles = this.getAllRoles();
    if (roles.some((role) => role.id === id)) {
      throw new Error(`角色 "${id}" 已存在`);
    }

    const fullRole: RoleConfig = { ...roleData, id };
    await this.roleStore.setRoles([...roles, fullRole]);
    logger.info('角色已创建', { roleId: id });

    return fullRole;
  }

  async deleteRole(roleId: string): Promise<void> {
    if (roleId === 'default') {
      throw new Error('默认角色不可删除');
    }

    const roles = this.getAllRoles();
    if (!roles.some((role) => role.id === roleId)) {
      throw new Error(`未找到角色 "${roleId}"`);
    }

    await this.roleStore.setRoles(roles.filter((role) => role.id !== roleId));
    logger.info('角色已删除', { roleId });
  }
}