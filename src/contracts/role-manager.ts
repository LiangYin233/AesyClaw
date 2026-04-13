import type { RoleConfig } from '@/features/roles/types.js';

export interface IRoleManager {
  getRoleConfig(roleId: string): RoleConfig;
  getRole(roleId: string): RoleConfig | null;
  getAllRoles(): RoleConfig[];
  isInitialized(): boolean;
  initialize(): Promise<void>;
}
