import type { IRoleManager } from '../contracts/role-manager.js';
import { roleManager } from '../features/roles/role-manager.js';
import type { RoleConfig, RoleWithMetadata } from '../features/roles/types.js';

export class RoleManagerAdapter implements IRoleManager {
  private toRoleConfig(role: RoleWithMetadata): RoleConfig {
    return {
      name: role.name,
      description: role.description,
      system_prompt: role.system_prompt,
      allowed_tools: role.allowed_tools,
      allowed_skills: role.allowed_skills,
      model: role.model,
      enabled: role.enabled,
    };
  }

  getRole(roleId: string): RoleConfig | undefined {
    const role = roleManager.getRole(roleId);
    return role ? this.toRoleConfig(role) : undefined;
  }

  getRoleConfig(roleId: string): RoleConfig {
    return roleManager.getRoleConfig(roleId) as unknown as RoleConfig;
  }

  getDefaultRole(): RoleConfig {
    return roleManager.getRoleConfig('default') as unknown as RoleConfig;
  }

  getAllRoles(): RoleConfig[] {
    return roleManager.getAllRoles().map(r => this.toRoleConfig(r));
  }

  getRolesByPermission(permission: string): RoleConfig[] {
    return roleManager
      .getAllRoles()
      .filter(role => role.allowed_tools.includes('*') || role.allowed_tools.includes(permission))
      .map(role => this.toRoleConfig(role));
  }

  isInitialized(): boolean {
    return roleManager.isInitialized();
  }

  async initialize(): Promise<void> {
    await roleManager.initialize();
  }

  isToolAllowed(roleId: string, toolName: string): boolean {
    return roleManager.isToolAllowed(roleId, toolName);
  }

  getAllowedTools(roleId: string, allTools: string[]): string[] {
    return roleManager.getAllowedTools(roleId, allTools);
  }
}

export const roleManagerAdapter = new RoleManagerAdapter();
