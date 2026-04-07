import * as fs from 'fs';
import * as path from 'path';
import { RoleConfig, RoleConfigSchema, RoleWithMetadata, RoleMetadata, DEFAULT_ROLE_ID, DEFAULT_ROLE_CONFIG } from './types.js';

export { DEFAULT_ROLE_ID } from './types.js';
import { logger } from '../../platform/observability/logger.js';
import { pathResolver } from '../../platform/utils/paths.js';

export class RoleManager {
  private static instance: RoleManager;
  private roles: Map<string, RoleWithMetadata> = new Map();
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private rolesDir: string;
  private initialized: boolean = false;

  private constructor() {
    this.rolesDir = path.join(pathResolver.getConfigDir(), 'roles');
  }

  static getInstance(): RoleManager {
    if (!RoleManager.instance) {
      RoleManager.instance = new RoleManager();
    }
    return RoleManager.instance;
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
      const files = fs.readdirSync(this.rolesDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        const roleId = path.basename(file, '.json');
        await this.loadRole(roleId);
      }

      if (!this.roles.has(DEFAULT_ROLE_ID)) {
        this.roles.set(DEFAULT_ROLE_ID, {
          ...DEFAULT_ROLE_CONFIG,
          metadata: {
            id: DEFAULT_ROLE_ID,
            fileName: `${DEFAULT_ROLE_ID}.json`,
            loadedAt: new Date(),
            updatedAt: new Date(),
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

    if (!fs.existsSync(filePath)) {
      logger.debug({ roleId }, 'Role file not found');
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const rawConfig = JSON.parse(content) as Partial<RoleConfig>;

      const result = RoleConfigSchema.safeParse(rawConfig);

      if (!result.success) {
        logger.error({ roleId, issues: result.error.issues }, 'Role validation failed');
        return null;
      }

      const config = result.data;

      if (!config.enabled) {
        logger.debug({ roleId }, 'Role is disabled, skipping');
        this.roles.delete(roleId);
        return null;
      }

      const stats = fs.statSync(filePath);
      const metadata: RoleMetadata = {
        id: roleId,
        fileName: `${roleId}.json`,
        loadedAt: new Date(),
        updatedAt: stats.mtime,
      };

      const roleWithMeta: RoleWithMetadata = {
        ...config,
        metadata,
      };

      this.roles.set(roleId, roleWithMeta);
      logger.debug({ roleId, name: config.name }, 'Role loaded');

      return roleWithMeta;
    } catch (error) {
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
            }
          });
        }
      });

      watcher.on('error', (error) => {
        logger.error({ error }, 'Role directory watcher error');
      });

      logger.info({}, 'Role file watchers initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to setup role watchers');
    }
  }

  private watcherCleanup(): void {
    for (const [id, watcher] of this.watchers) {
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

  getAllRoleIds(): string[] {
    return Array.from(this.roles.keys());
  }

  getRolesList(): Array<{ id: string; name: string; description: string }> {
    return this.getAllRoles().map(role => ({
      id: role.metadata.id,
      name: role.name,
      description: role.description || '',
    }));
  }

  createRole(roleId: string, config: Partial<RoleConfig>): { success: boolean; message: string } {
    if (this.roles.has(roleId)) {
      return { success: false, message: `角色 "${roleId}" 已存在` };
    }

    if (!config.model) {
      return { success: false, message: '创建角色时必须指定 model (格式: provider/model)' };
    }

    const fullConfig: RoleConfig = {
      name: config.name || roleId,
      description: config.description || '',
      system_prompt: config.system_prompt || '你是一个有帮助的AI助手。',
      allowed_tools: config.allowed_tools || ['*'],
      allowed_skills: config.allowed_skills || [],
      model: config.model,
      enabled: config.enabled !== undefined ? config.enabled : true,
    };

    try {
      const result = RoleConfigSchema.safeParse(fullConfig);
      if (!result.success) {
        return { success: false, message: `配置校验失败: ${result.error.issues[0]?.message}` };
      }

      this.saveRoleFile(roleId, fullConfig);
      this.loadRole(roleId);

      return { success: true, message: `角色 "${roleId}" 创建成功` };
    } catch (error) {
      return { success: false, message: `创建失败: ${error instanceof Error ? error.message : '未知错误'}` };
    }
  }

  updateRole(roleId: string, updates: Partial<RoleConfig>): { success: boolean; message: string } {
    if (roleId === DEFAULT_ROLE_ID) {
      return { success: false, message: '不能修改默认角色' };
    }

    const existing = this.getRole(roleId);
    if (!existing) {
      return { success: false, message: `角色 "${roleId}" 不存在` };
    }

    const fullConfig: RoleConfig = {
      name: updates.name ?? existing.name,
      description: updates.description ?? existing.description,
      system_prompt: updates.system_prompt ?? existing.system_prompt,
      allowed_tools: updates.allowed_tools ?? existing.allowed_tools,
      allowed_skills: updates.allowed_skills ?? existing.allowed_skills,
      model: updates.model ?? existing.model,
      enabled: updates.enabled ?? existing.enabled,
    };

    try {
      const result = RoleConfigSchema.safeParse(fullConfig);
      if (!result.success) {
        return { success: false, message: `配置校验失败: ${result.error.issues[0]?.message}` };
      }

      this.saveRoleFile(roleId, fullConfig);
      this.loadRole(roleId);

      return { success: true, message: `角色 "${roleId}" 更新成功` };
    } catch (error) {
      return { success: false, message: `更新失败: ${error instanceof Error ? error.message : '未知错误'}` };
    }
  }

  deleteRole(roleId: string): { success: boolean; message: string } {
    if (roleId === DEFAULT_ROLE_ID) {
      return { success: false, message: '不能删除默认角色' };
    }

    const filePath = this.getRoleFilePath(roleId);
    if (!fs.existsSync(filePath)) {
      return { success: false, message: `角色 "${roleId}" 不存在` };
    }

    try {
      fs.unlinkSync(filePath);
      this.roles.delete(roleId);
      logger.info({ roleId }, 'Role deleted');
      return { success: true, message: `角色 "${roleId}" 已删除` };
    } catch (error) {
      return { success: false, message: `删除失败: ${error instanceof Error ? error.message : '未知错误'}` };
    }
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

  isSkillAllowed(roleId: string, skillName: string): boolean {
    const config = this.getRoleConfig(roleId);
    return config.allowed_skills.includes('*') || config.allowed_skills.includes(skillName);
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

export const roleManager = RoleManager.getInstance();
