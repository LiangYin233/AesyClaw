/**
 * RoleManager — loads role configurations, watches for changes, and
 * constructs system prompts by combining the role's template with
 * tool lists, skill content, and available role descriptions.
 *
 * Role files are JSON validated against the RoleConfigSchema at load time.
 * Hot-reload is supported via `fs.watch`.
 */

import fs from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Value } from '@sinclair/typebox/value';
import { createScopedLogger } from '../core/logger';
import { AppError } from '../core/errors';
import type { RoleConfig, Skill, Unsubscribe } from '../core/types';
import { RoleConfigSchema } from './role-schema';
import type { AesyClawTool } from '../tool/tool-registry';
import { buildSkillPromptSection } from '../skill/skill-prompt';

const logger = createScopedLogger('role');

export class RoleManager {
  private roles: Map<string, RoleConfig> = new Map();
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 300;
  private rolesDir: string | null = null;
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
    this.roles.clear();

    mkdirSync(rolesDir, { recursive: true });

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(rolesDir, { withFileTypes: true });
    } catch (err) {
      logger.error(`Failed to read roles directory: ${rolesDir}`, err);
      throw err;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const filePath = path.join(rolesDir, entry.name);
      try {
        const role = this.parseRoleFile(filePath);
        if (role) {
          if (this.roles.has(role.id)) {
            logger.warn(`Duplicate role id "${role.id}" — overriding previous definition`);
          }
          this.roles.set(role.id, role);
        }
      } catch (err) {
        logger.warn(`Skipping invalid role file: ${filePath}`, err);
      }
    }

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

    // Find the file containing this role
    const entries = fs.readdirSync(this.rolesDir, { withFileTypes: true });
    let targetFile: string | null = null;

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const filePath = path.join(this.rolesDir, entry.name);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          (parsed as Record<string, unknown>).id === roleId
        ) {
          targetFile = filePath;
          break;
        }
      } catch {
        // Skip unreadable files
      }
    }

    if (!targetFile) {
      throw new AppError(`Role file for "${roleId}" not found`, 'CONFIG_VALIDATION');
    }

    fs.writeFileSync(targetFile, JSON.stringify(roleData, null, 2), 'utf-8');

    // Update in-memory cache
    this.roles.set(roleId, roleData);
    this.notifyChanges();
    logger.info('Role saved', { roleId, file: targetFile });
  }

  // ─── System prompt ────────────────────────────────────────────

  /**
   * Build the full system prompt for a role.
   *
   * 1. Start with the role's `systemPrompt` template
   * 2. Replace template variables: `{{date}}`, `{{os}}`, `{{systemLang}}`
   * 3. Append available tool list
   * 4. Append skill content sections
   * 5. Append available role descriptions (for sub-agent routing)
   */
  buildSystemPrompt(
    role: RoleConfig,
    availableTools: AesyClawTool[],
    skills: Skill[],
    allRoles: RoleConfig[],
  ): string {
    // 1. Template replacement
    let prompt = this.replaceTemplateVariables(role.systemPrompt);

    // 2. Append tool list
    if (availableTools.length > 0) {
      const toolSection = this.buildToolSection(availableTools);
      prompt += `\n\n${toolSection}`;
    }

    // 3. Append skill sections
    if (skills.length > 0) {
      prompt += `\n\n${buildSkillPromptSection(skills)}`;
    }

    // 4. Append available roles
    if (allRoles.length > 0) {
      const roleLines = allRoles.map((r) => `- **${r.id}**: ${r.name} — ${r.description}`);
      prompt += `\n\n## Available Roles\n${roleLines.join('\n')}`;
    }

    return prompt;
  }

  // ─── Private helpers ───────────────────────────────────────────

  /**
   * Replace template variables in a prompt string.
   *
   * Supported variables:
   * - `{{date}}` — Current ISO date (YYYY-MM-DD)
   * - `{{os}}` — `process.platform`
   * - `{{systemLang}}` — `process.env.LANG` or 'unknown'
   */
  private replaceTemplateVariables(template: string): string {
    return template
      .replace(/\{\{date}}/g, new Date().toISOString().split('T')[0] ?? new Date().toISOString())
      .replace(/\{\{os}}/g, process.platform)
      .replace(/\{\{systemLang}}/g, process.env.LANG ?? 'unknown');
  }

  /**
   * Build the tool description section for the system prompt.
   */
  private buildToolSection(tools: AesyClawTool[]): string {
    const toolLines = tools.map((tool) => `- **${tool.name}**: ${tool.description}`);
    return `## Available Tools\n${toolLines.join('\n')}`;
  }

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
