/** RoleManager — 持有角色缓存并通过 ConfigManager 持久化 roles.json。 */

import { randomUUID } from 'node:crypto';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { RoleConfig, Unsubscribe } from '@aesyclaw/core/types';

const logger = createScopedLogger('role');

export type RoleManagerDependencies = { configManager: ConfigManager };

export class RoleManager {
  private roles: Map<string, RoleConfig> = new Map();
  private configManager: ConfigManager | null = null;
  private unsubscribeRoles: Unsubscribe | null = null;
  private changeListeners: Array<() => void> = [];

  // ─── 生命周期 ────────────────────────────────────────────────

  async initialize(deps: RoleManagerDependencies): Promise<void> {
    this.destroy();
    this.configManager = deps.configManager;
    this.replaceRoles(deps.configManager.getRoles());
    this.unsubscribeRoles = deps.configManager.subscribeRoles((roles) => {
      this.replaceRoles(roles);
      this.notifyChanges();
    });
  }

  destroy(): void {
    if (this.unsubscribeRoles) {
      this.unsubscribeRoles();
      this.unsubscribeRoles = null;
    }
  }

  subscribeChanges(listener: () => void): Unsubscribe {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter((candidate) => candidate !== listener);
    };
  }

  // ─── 读取 ──────────────────────────────────────────────────────

  /** 通过 ID 获取角色。如果未找到，则回退到 `getDefaultRole()`。 */
  getRole(roleId: string): RoleConfig {
    const role = this.roles.get(roleId);
    if (role) return role;
    logger.warn(`未找到角色 "${roleId}" — 回退到默认角色`);
    return this.getDefaultRole();
  }

  /** 获取默认角色: id 为 'default' 的角色，或第一个启用的角色。 */
  getDefaultRole(): RoleConfig {
    const defaultRole = this.roles.get('default');
    if (defaultRole) return defaultRole;

    const firstEnabled = this.getEnabledRoles()[0];
    if (firstEnabled !== undefined) return firstEnabled;

    throw new Error('没有可用角色 — 必须至少定义一个角色');
  }

  /** 获取所有已启用的角色。 */
  getEnabledRoles(): RoleConfig[] {
    return [...this.roles.values()].filter((role) => role.enabled);
  }

  /** 获取所有角色（包括已禁用的）。 */
  getAllRoles(): RoleConfig[] {
    return [...this.roles.values()];
  }

  // ─── 写入 ─────────────────────────────────────────────────────

  async saveRole(roleId: string, roleData: RoleConfig): Promise<void> {
    const configManager = this.requireConfigManager();
    if (!this.roles.has(roleId)) {
      throw new Error(`未找到角色 "${roleId}"`);
    }

    const roles = this.getAllRoles().map((role) => (role.id === roleId ? roleData : role));
    await configManager.updateRoles(roles);
    logger.info('角色已保存', { roleId });
  }

  async createRole(roleData: Omit<RoleConfig, 'id'> & { id?: string }): Promise<RoleConfig> {
    const configManager = this.requireConfigManager();
    const id = roleData.id ?? randomUUID();
    if (this.roles.has(id)) {
      throw new Error(`角色 "${id}" 已存在`);
    }

    const fullRole: RoleConfig = { ...roleData, id };
    await configManager.updateRoles([...this.getAllRoles(), fullRole]);
    logger.info('角色已创建', { roleId: id });

    return fullRole;
  }

  async deleteRole(roleId: string): Promise<void> {
    const configManager = this.requireConfigManager();
    if (roleId === 'default') {
      throw new Error('默认角色不可删除');
    }

    if (!this.roles.has(roleId)) {
      throw new Error(`未找到角色 "${roleId}"`);
    }

    await configManager.updateRoles(this.getAllRoles().filter((role) => role.id !== roleId));
    logger.info('角色已删除', { roleId });
  }

  // ─── 私有辅助方法 ───────────────────────────────────────────

  private replaceRoles(roles: readonly RoleConfig[]): void {
    this.roles = new Map(
      roles.map((role) => [role.id, role.id === 'default' ? { ...role, enabled: true } : role]),
    );
    logger.info(`已加载 ${this.roles.size} 个角色`);
  }

  private requireConfigManager(): ConfigManager {
    if (!this.configManager) {
      throw new Error('角色管理器未初始化');
    }
    return this.configManager;
  }

  private notifyChanges(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (err) {
        logger.error('角色变更监听器失败', err);
      }
    }
  }
}
