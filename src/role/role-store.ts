import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import Conf from 'conf';
import type { RoleConfig } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { AsyncMutex } from '@aesyclaw/core/mutex';
import { DEFAULT_ROLES_CONFIG } from './default-role';
import { RolesConfigSchema } from './role-schema';

const logger = createScopedLogger('role-store');

export class RoleStore {
  private readonly ROLES_STORE_KEY = 'roles';
  private rolesStore: Conf<Record<string, unknown>>;
  private lastKnownRoles: readonly RoleConfig[];
  private rolesMutex = new AsyncMutex();
  private unsubscribeRolesHotReload?: () => void;
  private readonly rolesPath: string;

  constructor(rolesPath: string) {
    this.rolesPath = rolesPath;
    this.ensureDir();
    const loaded = this.loadRoles();
    this.rolesStore = loaded.store;
    this.lastKnownRoles = loaded.roles;
  }

  private ensureDir(): void {
    mkdirSync(dirname(this.rolesPath), { recursive: true });
  }

  getRoles(): readonly RoleConfig[] {
    return structuredClone(this.lastKnownRoles);
  }

  async setRoles(roles: readonly RoleConfig[]): Promise<void> {
    const validated = this.validate<RoleConfig[]>(RolesConfigSchema, roles, '角色配置');
    const normalised = normaliseRoles(validated);
    this.assertUniqueRoleIds(normalised);
    await this.persistRolesWithGuard(normalised);
  }

  startHotReload(): void {
    this.stopHotReload();
    this.unsubscribeRolesHotReload = this.rolesStore.onDidAnyChange(() => {
      void this.reloadRolesFromFile();
    });
    logger.info('角色热重载监视器已启动');
  }

  stopHotReload(): void {
    this.unsubscribeRolesHotReload?.();
    this.unsubscribeRolesHotReload = undefined;
    logger.info('角色热重载监视器已停止');
  }

  private loadRoles(): {
    store: Conf<Record<string, unknown>>;
    roles: readonly RoleConfig[];
  } {
    if (!existsSync(this.rolesPath)) {
      logger.info('未找到角色配置文件，正在使用默认值创建', { path: this.rolesPath });
      const store = this.createStore(this.rolesPath);
      this.writeRolesToStore(store, DEFAULT_ROLES_CONFIG);
      return { store, roles: structuredClone(DEFAULT_ROLES_CONFIG) };
    }

    logger.info('正在加载角色配置', { path: this.rolesPath });
    const store = this.createStore(this.rolesPath);
    const roles = this.readValidatedRolesFromStore(store);
    return { store, roles };
  }

  private readValidatedRolesFromStore(store: Conf<Record<string, unknown>>): RoleConfig[] {
    const raw = store.store[this.ROLES_STORE_KEY];
    const validated = this.validate<RoleConfig[]>(RolesConfigSchema, raw, '角色配置');
    const roles = normaliseRoles(validated);
    this.assertUniqueRoleIds(roles);
    return roles;
  }

  private writeRolesToStore(store: Conf<Record<string, unknown>>, roles: readonly RoleConfig[]): void {
    store.store = {
      [this.ROLES_STORE_KEY]: structuredClone(roles),
    } as Record<string, unknown>;
  }

  private async persistRolesWithGuard(roles: readonly RoleConfig[]): Promise<void> {
    await this.rolesMutex.runExclusive(async () => {
      this.writeRolesToStore(this.rolesStore, roles);
      this.lastKnownRoles = structuredClone(roles);
    });
  }

  private async reloadRolesFromFile(): Promise<void> {
    await this.rolesMutex.runExclusive(async () => {
      try {
        const newRoles = this.readValidatedRolesFromStore(this.rolesStore);
        if (JSON.stringify(this.lastKnownRoles) === JSON.stringify(newRoles)) {
          logger.debug('角色配置文件已变更但内容相同 —— 跳过');
          return;
        }
        this.lastKnownRoles = structuredClone(newRoles);
        logger.info('已从文件重新加载角色配置缓存');
      } catch (err) {
        logger.error('重新加载角色配置文件失败，继续使用上一次有效角色配置', err);
      }
    });
  }

  private assertUniqueRoleIds(roles: readonly RoleConfig[]): void {
    const seen = new Set<string>();
    for (const role of roles) {
      if (seen.has(role.id)) {
        throw new Error(`角色 id "${role.id}" 重复`);
      }
      seen.add(role.id);
    }
  }

  private validate<T>(schema: Parameters<typeof Value.Check>[0], value: unknown, label: string): T {
    const validated = Value.Default(schema, value) as T;
    if (!Value.Check(schema, validated)) {
      const errors = [...Value.Errors(schema, validated)]
        .map((e) => `${e.path}: ${e.message}`)
        .join('; ');
      throw new Error(`${label}验证失败: ${errors}`);
    }
    return validated;
  }

  private createStore(filePath: string): Conf<Record<string, unknown>> {
    const extension = extname(filePath);
    const fileExtension = extension.startsWith('.') ? extension.slice(1) : extension;

    try {
      return new Conf<Record<string, unknown>>({
        cwd: dirname(filePath),
        configName: extension ? basename(filePath, extension) : basename(filePath),
        fileExtension,
        clearInvalidConfig: false,
        serialize: (value) => JSON.stringify(value[this.ROLES_STORE_KEY] ?? [], null, 2),
        deserialize: (value) => ({ [this.ROLES_STORE_KEY]: JSON.parse(value) }),
        watch: true,
      });
    } catch (err) {
      throw new Error('角色配置文件中的 JSON 无效', { cause: err });
    }
  }
}

function normaliseRoles(roles: readonly RoleConfig[]): RoleConfig[] {
  return roles.map((role) => (role.id === 'default' ? { ...role, enabled: true } : role));
}