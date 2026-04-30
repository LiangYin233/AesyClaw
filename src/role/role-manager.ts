/**
 * RoleManager — loads role configurations and watches for changes.
 *
 * Role files are JSON validated against the RoleConfigSchema at load time.
 * Hot-reload is supported via `fs.watch`.
 */

import fs from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { createScopedLogger } from '../core/logger';
import { AppError } from '../core/errors';
import type { RoleConfig, Unsubscribe } from '../core/types';
import { RoleConfigSchema } from './role-schema';

const logger = createScopedLogger('role');

export class RoleManager {
  private roles: Map<string, RoleConfig> = new Map();
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 300;
  private rolesDir: string | null = null;
  private roleSources: Map<string, string> = new Map();
  private changeListeners: Array<() => void> = [];

  // ─── Lifecycle ────────────────────────────────────────────────

  /**
   * Load all role JSON files from the given directory.
   *
   * Each file is parsed and validated against `RoleConfigSchema`.
   * Malformed files are skipped with a warning.
   */
  async loadAll(rolesDir: string): Promise<void> {
    this.rolesDir = rolesDir;

    mkdirSync(rolesDir, { recursive: true });

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(rolesDir, { withFileTypes: true });
    } catch (err) {
      logger.error(`Failed to read roles directory: ${rolesDir}`, err);
      throw err;
    }

    const loadedRoles = new Map<string, RoleConfig>();
    const loadedSources = new Map<string, string>();

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const filePath = path.join(rolesDir, entry.name);
      try {
        const role = this.parseRoleFile(filePath);
        if (role) {
          const existingSource = loadedSources.get(role.id);
          if (existingSource) {
            throw new AppError(
              `Duplicate role id "${role.id}" in ${existingSource} and ${filePath}`,
              'CONFIG_VALIDATION',
            );
          }
          loadedRoles.set(role.id, role);
          loadedSources.set(role.id, filePath);
        }
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        logger.warn(`Skipping invalid role file: ${filePath}`, err);
      }
    }

    this.roles = loadedRoles;
    this.roleSources = loadedSources;

    logger.info(`Loaded ${this.roles.size} roles`);
    this.notifyChanges();
  }

  subscribeChanges(listener: () => void): Unsubscribe {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter((candidate) => candidate !== listener);
    };
  }

  /** Start watching the roles directory for changes. */
  startWatching(): void {
    if (!this.rolesDir) {
      throw new AppError('Roles not loaded — cannot start watching', 'CONFIG_VALIDATION');
    }

    if (this.watcher) {
      return; // Already watching
    }

    this.watcher = fs.watch(this.rolesDir, () => {
      this.handleFileChange();
    });

    this.watcher.on('error', (err: Error) => {
      logger.error('Roles directory watcher error', err);
    });

    logger.info('Role hot-reload watcher started');
  }

  /** Stop watching the roles directory. */
  stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('Role hot-reload watcher stopped');
    }
  }

  // ─── Read ──────────────────────────────────────────────────────

  /** Get a role by ID. Falls back to `getDefaultRole()` if not found. */
  getRole(roleId: string): RoleConfig {
    const role = this.roles.get(roleId);
    if (role) return role;
    logger.warn(`Role "${roleId}" not found — falling back to default`);
    return this.getDefaultRole();
  }

  /** Get the default role: the one with `id === 'default'`, or the first enabled role. */
  getDefaultRole(): RoleConfig {
    const defaultRole = this.roles.get('default');
    if (defaultRole) return defaultRole;

    const firstEnabled = this.getEnabledRoles()[0];
    if (firstEnabled) return firstEnabled;

    throw new AppError(
      'No roles available — at least one role must be defined',
      'CONFIG_VALIDATION',
    );
  }

  /** Get all enabled roles. */
  getEnabledRoles(): RoleConfig[] {
    return [...this.roles.values()].filter((r) => r.enabled);
  }

  /** Get all roles (including disabled). */
  getAllRoles(): RoleConfig[] {
    return [...this.roles.values()];
  }

  /** Get the roles directory path. */
  getRolesDir(): string | null {
    return this.rolesDir;
  }

  /**
   * Save a role back to its source file and update the in-memory cache.
   *
   * @throws If the role file cannot be found or the data fails validation.
   */
  async saveRole(roleId: string, roleData: RoleConfig): Promise<void> {
    if (!this.rolesDir) {
      throw new AppError('Roles not loaded', 'CONFIG_VALIDATION');
    }

    const validated = Value.Default(RoleConfigSchema, roleData);
    if (!Value.Check(RoleConfigSchema, validated)) {
      const errors = [...Value.Errors(RoleConfigSchema, validated)];
      throw new AppError('Role validation failed', 'CONFIG_VALIDATION', errors);
    }

    const targetFile = this.roleSources.get(roleId) ?? null;

    if (!targetFile) {
      throw new AppError(`Role file for "${roleId}" not found`, 'CONFIG_VALIDATION');
    }

    fs.writeFileSync(targetFile, JSON.stringify(roleData, null, 2), 'utf-8');

    // Update in-memory cache
    this.roles.set(roleId, roleData);
    this.roleSources.set(roleId, targetFile);
    this.notifyChanges();
    logger.info('Role saved', { roleId, file: targetFile });
  }

  /**
   * Create a new role and persist it to the roles directory.
   *
   * @param roleData Role configuration (id will be auto-generated if empty).
   * @returns The created RoleConfig.
   * @throws If the roles directory is not available or validation fails.
   */
  async createRole(roleData: Omit<RoleConfig, 'id'> & { id?: string }): Promise<RoleConfig> {
    if (!this.rolesDir) {
      throw new AppError('Roles not loaded', 'CONFIG_VALIDATION');
    }

    const id = roleData.id || randomUUID();
    const fullRole: RoleConfig = { ...roleData, id };

    const validated = Value.Default(RoleConfigSchema, fullRole);
    if (!Value.Check(RoleConfigSchema, validated)) {
      const errors = [...Value.Errors(RoleConfigSchema, validated)];
      throw new AppError('Role validation failed', 'CONFIG_VALIDATION', errors);
    }

    const filename = `${id}.json`;
    const filePath = path.join(this.rolesDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), 'utf-8');

    this.roles.set(id, validated);
    this.roleSources.set(id, filePath);
    this.notifyChanges();
    logger.info('Role created', { roleId: id, file: filePath });

    return validated;
  }

  // ─── Private helpers ───────────────────────────────────────────

  /**
   * Parse and validate a role JSON file.
   *
   * @returns Validated `RoleConfig`, or `null` if the file is invalid.
   */
  private parseRoleFile(filePath: string): RoleConfig | null {
    const raw = fs.readFileSync(filePath, 'utf-8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.warn(`Invalid JSON in role file: ${filePath}`, err);
      return null;
    }

    const role = Value.Default(RoleConfigSchema, parsed);

    if (!Value.Check(RoleConfigSchema, role)) {
      const errors = [...Value.Errors(RoleConfigSchema, role)];
      logger.warn(`Role validation failed for ${filePath}: ${JSON.stringify(errors)}`);
      return null;
    }

    const roleConfig = role as RoleConfig;
    return roleConfig.id === 'default' ? { ...roleConfig, enabled: true } : roleConfig;
  }

  /**
   * Handle a file change event by reloading all roles.
   */
  private handleFileChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      if (this.rolesDir) {
        try {
          await this.loadAll(this.rolesDir);
          logger.info('Roles reloaded after file change');
        } catch (err) {
          logger.error('Failed to reload roles after file change', err);
        }
      }
    }, this.DEBOUNCE_MS);
  }

  private notifyChanges(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (err) {
        logger.error('Role change listener failed', err);
      }
    }
  }
}
