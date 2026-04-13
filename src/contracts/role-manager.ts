import type { RoleConfig } from '@/features/roles/types.js';

export interface IRoleManager {
  getRole(roleId: string): RoleConfig | undefined;
  getRoleConfig(roleId: string): RoleConfig;
  getDefaultRole(): RoleConfig;
  getAllRoles(): RoleConfig[];
  getRolesByPermission(permission: string): RoleConfig[];
  isInitialized(): boolean;
  initialize(): Promise<void>;
}
