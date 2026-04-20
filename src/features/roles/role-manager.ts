import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@/platform/observability/logger.js';
import { pathResolver } from '@/platform/utils/paths.js';
import {
  RoleConfig,
  RoleConfigSchema,
  RoleWithMetadata,
  DEFAULT_ROLE_ID,
  DEFAULT_ROLE_CONFIG,
  type ToolAccessConfig,
} from './types.js';

export { DEFAULT_ROLE_ID } from './types.js';

export class RoleManager {
  private roles: Map<string, RoleWithMetadata> = new Map();
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private rolesDir: string;
  private initialized: boolean = false;

  constructor() {
    this.rolesDir = pathResolver.getRolesDir();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn({}, 'RoleManager already initialized');
      return;
    }

    logger.info({}, 'Initializing RoleManager...');

    this.ensureRolesDirectory();
    this.ensureDefaultRole();

    await this.loadAllRoles();

    this.setupWatchers();

    this.initialized = true;
    logger.info({ roleCount: this.roles.size }, 'RoleManager initialized');
  }

  private ensureRolesDirectory(): void {
    pathResolver.ensureDirectoryExists(this.rolesDir);
  }

  private ensureDefaultRole(): void {
    const defaultPath = this.getRoleFilePath(DEFAULT_ROLE_ID);
    if (!fs.existsSync(defaultPath)) {
      this.saveRoleFile(DEFAULT_ROLE_ID, DEFAULT_ROLE_CONFIG);
      logger.info({}, 'Created default role file');
    }
  }

  private getRoleFilePath(roleId: string): string {
    return path.join(this.rolesDir, `${roleId}.json`);
  }

  private buildRoleWithMetadata(
    roleId: string,
    config: RoleConfig,
    updatedAt: Date,
    loadedAt = new Date()
  ): RoleWithMetadata {
    return {
      ...config,
      metadata: {
        id: roleId,
        fileName: `${roleId}.json`,
        loadedAt,
        updatedAt,
      },
    };
  }

  private removeRole(roleId: string, message: string, level: 'debug' | 'error', extra: Record<string, unknown> = {}): null {
    this.roles.delete(roleId);
    if (level === 'error') {
      logger.error({ roleId, ...extra }, message);
    } else {
      logger.debug({ roleId, ...extra }, message);
    }

    return null;
  }

  private getFallbackRole(roleId: string): RoleWithMetadata | null {
    const role = this.getRole(roleId);
    if (role) {
      return role;
    }

    const defaultRole = this.getRole(DEFAULT_ROLE_ID);
    if (defaultRole) {
      logger.warn({ requestedRoleId: roleId }, 'Role not found, returning default');
      return defaultRole;
    }

    return null;
  }

  private async loadAllRoles(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.rolesDir);
      const roleIds = files
        .filter(f => f.endsWith('.json'))
        .map(f => path.basename(f, '.json'));

      await Promise.all(roleIds.map(id => this.loadRole(id)));

      if (!this.roles.has(DEFAULT_ROLE_ID)) {
        const now = new Date();
        this.roles.set(DEFAULT_ROLE_ID, this.buildRoleWithMetadata(DEFAULT_ROLE_ID, DEFAULT_ROLE_CONFIG, now, now));
      }

      logger.info({ loadedCount: this.roles.size }, 'All roles loaded');
    } catch (error) {
      logger.error({ error }, 'Failed to load roles');
      throw error;
    }
  }

  private async loadRole(roleId: string): Promise<RoleWithMetadata | null> {
    const filePath = this.getRoleFilePath(roleId);

    try {
      const [content, stats] = await Promise.all([
        fs.promises.readFile(filePath, 'utf-8'),
        fs.promises.stat(filePath),
      ]);

      const rawConfig = JSON.parse(content) as Partial<RoleConfig>;
      const result = RoleConfigSchema.safeParse(rawConfig);

      if (!result.success) {
        return this.removeRole(roleId, 'Role validation failed', 'error', { issues: result.error.issues });
      }

      const config = result.data;
      if (!config.enabled) {
        return this.removeRole(roleId, 'Role is disabled, skipping', 'debug');
      }

      const roleWithMeta = this.buildRoleWithMetadata(roleId, config, stats.mtime);

      this.roles.set(roleId, roleWithMeta);
      logger.debug({ roleId, name: config.name }, 'Role loaded');
      return roleWithMeta;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return this.removeRole(roleId, 'Role file not found', 'debug');
      }
      return this.removeRole(roleId, 'Failed to load role', 'error', { error });
    }
  }

  private async handleRoleFileChange(roleId: string, eventType: string): Promise<void> {
    logger.info({ roleId, eventType }, 'Role file changed, reloading...');

    try {
      const role = await this.loadRole(roleId);
      if (role) {
        logger.info({ roleId, name: role.name }, 'Role hot-reloaded');
        return;
      }

      logger.info({ roleId }, 'Role removed or disabled after reload');
    } catch (error) {
      logger.error({ roleId, error }, 'Failed to hot-reload role');
    }
  }

  private setupWatchers(): void {
    this.watcherCleanup();

    try {
      const watcher = fs.watch(this.rolesDir, { recursive: false }, (eventType, filename) => {
        if (filename && filename.endsWith('.json')) {
          const roleId = path.basename(filename, '.json');
          void this.handleRoleFileChange(roleId, eventType);
        }
      });

      this.watchers.set(this.rolesDir, watcher);

      watcher.on('error', (error) => {
        logger.error({ error }, 'Role directory watcher error');
      });

      logger.info({}, 'Role file watchers initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to setup role watchers');
    }
  }

  private watcherCleanup(): void {
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
  }

  private saveRoleFile(roleId: string, config: RoleConfig): void {
    const filePath = this.getRoleFilePath(roleId);

    try {
      const content = JSON.stringify(config, null, 2);
      fs.writeFileSync(filePath, content, 'utf-8');
      logger.debug({ roleId }, 'Role file saved');
    } catch (error) {
      logger.error({ roleId, error }, 'Failed to save role file');
      throw error;
    }
  }

  getRole(roleId: string): RoleWithMetadata | null {
    return this.roles.get(roleId) || null;
  }

  getRoleConfig(roleId: string): RoleConfig {
    const role = this.getFallbackRole(roleId);
    return role ? this.toRoleConfig(role) : DEFAULT_ROLE_CONFIG;
  }

  private toRoleConfig(role: RoleWithMetadata): RoleConfig {
    return {
      name: role.name,
      description: role.description,
      system_prompt: role.system_prompt,
      tool_access: role.tool_access,
      allowed_skills: role.allowed_skills,
      model: role.model,
      enabled: role.enabled,
    };
  }

  getAllRoles(): RoleWithMetadata[] {
    return Array.from(this.roles.values());
  }

  getRolesList(): Array<{ id: string; name: string; description: string }> {
    return this.getAllRoles().map(role => ({
      id: role.metadata.id,
      name: role.name,
      description: role.description || '',
    }));
  }

  isToolAllowed(roleId: string, toolName: string): boolean {
    return this.matchesToolAccess(this.getRoleConfig(roleId).tool_access, toolName);
  }

  getAllowedTools(roleId: string, allTools: string[]): string[] {
    return this.filterAllowedTools(this.getRoleConfig(roleId).tool_access, allTools);
  }

  describeToolAccess(roleId: string, allTools: string[]): {
    mode: ToolAccessConfig['mode'];
    configuredTools: string[];
    allowedTools: string[];
  } {
    const toolAccess = this.getRoleConfig(roleId).tool_access;
    return {
      mode: toolAccess.mode,
      configuredTools: [...toolAccess.tools],
      allowedTools: this.filterAllowedTools(toolAccess, allTools),
    };
  }

  private matchesToolAccess(toolAccess: ToolAccessConfig, toolName: string): boolean {
    if (toolAccess.mode === 'allowlist') {
      return toolAccess.tools.includes(toolName);
    }

    return !toolAccess.tools.includes(toolName);
  }

  private filterAllowedTools(toolAccess: ToolAccessConfig, allTools: string[]): string[] {
    return allTools.filter(toolName => this.matchesToolAccess(toolAccess, toolName));
  }

  shutdown(): void {
    this.watcherCleanup();
    this.roles.clear();
    this.initialized = false;
    logger.info({}, 'RoleManager shutdown');
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const roleManager = new RoleManager();
