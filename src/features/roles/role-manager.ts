import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@/platform/observability/logger.js';
import { pathResolver } from '@/platform/utils/paths.js';
import { RoleConfig, RoleConfigSchema, RoleWithMetadata, DEFAULT_ROLE_ID, DEFAULT_ROLE_CONFIG } from './types.js';

export { DEFAULT_ROLE_ID } from './types.js';

export class RoleManager {
  private roles: Map<string, RoleWithMetadata> = new Map();
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private rolesDir: string;
  private initialized: boolean = false;

  constructor() {
    this.rolesDir = path.join(pathResolver.getConfigDir(), 'roles');
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn({}, 'RoleManager already initialized');
      return;
    }

    logger.info({}, 'Initializing RoleManager...');

    this.ensureRolesDirectory();

    await this.loadAllRoles();

    this.setupWatchers();

    this.initialized = true;
    logger.info({ roleCount: this.roles.size }, 'RoleManager initialized');
  }

  private ensureRolesDirectory(): void {
    if (!fs.existsSync(this.rolesDir)) {
      fs.mkdirSync(this.rolesDir, { recursive: true });
      logger.info({ rolesDir: this.rolesDir }, 'Created roles directory');
    }

    const defaultPath = this.getRoleFilePath(DEFAULT_ROLE_ID);
    if (!fs.existsSync(defaultPath)) {
      this.saveRoleFile(DEFAULT_ROLE_ID, DEFAULT_ROLE_CONFIG);
      logger.info({}, 'Created default role file');
    }
  }

  private getRoleFilePath(roleId: string): string {
    return path.join(this.rolesDir, `${roleId}.json`);
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
        this.roles.set(DEFAULT_ROLE_ID, {
          ...DEFAULT_ROLE_CONFIG,
          metadata: {
            id: DEFAULT_ROLE_ID,
            fileName: `${DEFAULT_ROLE_ID}.json`,
            loadedAt: now,
            updatedAt: now,
          },
        });
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
        this.roles.delete(roleId);
        logger.error({ roleId, issues: result.error.issues }, 'Role validation failed');
        return null;
      }

      const config = result.data;
      if (!config.enabled) {
        logger.debug({ roleId }, 'Role is disabled, skipping');
        this.roles.delete(roleId);
        return null;
      }

      const roleWithMeta: RoleWithMetadata = {
        ...config,
        metadata: {
          id: roleId,
          fileName: `${roleId}.json`,
          loadedAt: new Date(),
          updatedAt: stats.mtime,
        },
      };

      this.roles.set(roleId, roleWithMeta);
      logger.debug({ roleId, name: config.name }, 'Role loaded');
      return roleWithMeta;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.roles.delete(roleId);
        logger.debug({ roleId }, 'Role file not found');
        return null;
      }
      this.roles.delete(roleId);
      logger.error({ roleId, error }, 'Failed to load role');
      return null;
    }
  }

  private setupWatchers(): void {
    this.watcherCleanup();

    try {
      const watcher = fs.watch(this.rolesDir, { recursive: false }, (eventType, filename) => {
        if (filename && filename.endsWith('.json')) {
          const roleId = path.basename(filename, '.json');
          logger.info({ roleId, eventType }, 'Role file changed, reloading...');

          this.loadRole(roleId).then(role => {
            if (role) {
              logger.info({ roleId, name: role.name }, 'Role hot-reloaded');
            } else {
              logger.info({ roleId }, 'Role removed or disabled after reload');
            }
          }).catch(error => {
            logger.error({ roleId, error }, 'Failed to hot-reload role');
          });
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
    const role = this.getRole(roleId);
    if (role) {
      return this.toRoleConfig(role);
    }

    const defaultRole = this.getRole(DEFAULT_ROLE_ID);
    if (defaultRole) {
      logger.warn({ requestedRoleId: roleId }, 'Role not found, returning default');
      return this.toRoleConfig(defaultRole);
    }

    return DEFAULT_ROLE_CONFIG;
  }

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
    const config = this.getRoleConfig(roleId);
    const allowed = config.allowed_tools;

    if (allowed.includes('*')) {
      return true;
    }

    return allowed.includes(toolName);
  }

  getAllowedTools(roleId: string, allTools: string[]): string[] {
    const config = this.getRoleConfig(roleId);

    if (config.allowed_tools.includes('*')) {
      return allTools;
    }

    return allTools.filter(tool => config.allowed_tools.includes(tool));
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
