/** RoleManager — 通过 ConfigManager 按需读取角色配置。 */

import { randomUUID } from 'node:crypto';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { RoleConfig } from '@aesyclaw/core/types';

const logger = createScopedLogger('role');

export type RoleManagerDependencies = { configManager: ConfigManager };

export class RoleManager {
  private configManager: ConfigManager | null = null;

  // ─── 生命周期 ────────────────────────────────────────────────

  async initialize(deps: RoleManagerDependencies): Promise<void> {
    this.configManager = deps.configManager;
    logger.info(`已加载 ${this.getAllRoles().length} 个角色`);
  }

  destroy(): void {
    this.configManager = null;
  }

  // ─── 读取 ──────────────────────────────────────────────────────

  /** 通过 ID 获取角色。如果未找到，则回退到 `getDefaultRole()`。 */
  getRole(roleId: string): RoleConfig {
    const role = this.getAllRoles().find((candidate) => candidate.id === roleId);
    if (role) return role;
    logger.warn(`未找到角色 "${roleId}" — 回退到默认角色`);
    return this.getDefaultRole();
  }

  /** 获取默认角色: id 为 'default' 的角色，或第一个启用的角色。 */
  getDefaultRole(): RoleConfig {
    const roles = this.getAllRoles();
    const defaultRole = roles.find((role) => role.id === 'default');
    if (defaultRole) return defaultRole;

    const firstEnabled = roles.find((role) => role.enabled);
    if (firstEnabled !== undefined) return firstEnabled;

    throw new Error('没有可用角色 — 必须至少定义一个角色');
  }

  /** 获取所有已启用的角色。 */
  getEnabledRoles(): RoleConfig[] {
    return this.getAllRoles().filter((role) => role.enabled);
  }

  /** 获取所有角色（包括已禁用的）。 */
  getAllRoles(): RoleConfig[] {
    return [...this.requireConfigManager().getRoles()];
  }

  // ─── 写入 ─────────────────────────────────────────────────────

  async saveRole(roleId: string, roleData: RoleConfig): Promise<void> {
    const configManager = this.requireConfigManager();
    const roles = this.getAllRoles();
    const existing = roles.find((role) => role.id === roleId);
    if (!existing) {
      throw new Error(`未找到角色 "${roleId}"`);
    }

    const updatedRoles = roles.map((role) => (role.id === roleId ? roleData : role));
    await configManager.setRoles(updatedRoles);
    logger.info('角色已保存', { roleId });
  }

  async createRole(roleData: Omit<RoleConfig, 'id'> & { id?: string }): Promise<RoleConfig> {
    const configManager = this.requireConfigManager();
    const id = roleData.id ?? randomUUID();
    const roles = this.getAllRoles();
    if (roles.some((role) => role.id === id)) {
      throw new Error(`角色 "${id}" 已存在`);
    }

    const fullRole: RoleConfig = { ...roleData, id };
    await configManager.setRoles([...roles, fullRole]);
    logger.info('角色已创建', { roleId: id });

    return fullRole;
  }

  async deleteRole(roleId: string): Promise<void> {
    const configManager = this.requireConfigManager();
    if (roleId === 'default') {
      throw new Error('默认角色不可删除');
    }

    const roles = this.getAllRoles();
    if (!roles.some((role) => role.id === roleId)) {
      throw new Error(`未找到角色 "${roleId}"`);
    }

    await configManager.setRoles(roles.filter((role) => role.id !== roleId));
    logger.info('角色已删除', { roleId });
  }

  // ─── 私有辅助方法 ───────────────────────────────────────────

  private requireConfigManager(): ConfigManager {
    if (!this.configManager) {
      throw new Error('角色管理器未初始化');
    }
    return this.configManager;
  }
}
