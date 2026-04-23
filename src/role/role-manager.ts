/**
 * RoleManager — loads role configurations, watches for changes, and
 * constructs system prompts by combining the role's template with
 * tool lists, skill content, and available role descriptions.
 *
 * Role files are JSON validated against the RoleConfigSchema at load time.
 * Hot-reload is supported via `fs.watch`.
 */

import fs from 'node:fs';
import { Value } from '@sinclair/typebox/value';
import { createScopedLogger } from '../core/logger';
import { ConfigValidationError } from '../core/errors';
import type { RoleConfig, Skill } from '../core/types';
import { RoleConfigSchema } from './role-schema';
import type { AesyClawTool } from '../tool/tool-registry';

const logger = createScopedLogger('role');

export class RoleManager {
  private roles: Map<string, RoleConfig> = new Map();
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 300;
  private rolesDir: string | null = null;

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

    if (!fs.existsSync(rolesDir)) {
      logger.warn(`Roles directory does not exist: ${rolesDir}`);
      return;
    }

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

      const filePath = `${rolesDir}/${entry.name}`;
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
  }

  /** Start watching the roles directory for changes. */
  startWatching(): void {
    if (!this.rolesDir) {
      throw new ConfigValidationError('Roles not loaded — cannot start watching', null);
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

    throw new ConfigValidationError('No roles available — at least one role must be defined', null);
  }

  /** Get all enabled roles. */
  getEnabledRoles(): RoleConfig[] {
    return [...this.roles.values()].filter((r) => r.enabled);
  }

  /** Get all roles (including disabled). */
  getAllRoles(): RoleConfig[] {
    return [...this.roles.values()];
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
      const skillLines = skills.map(
        (skill) => `## Skill: ${skill.name}\n${skill.content}`,
      );
      prompt += `\n\n${skillLines.join('\n\n')}`;
    }

    // 4. Append available roles
    if (allRoles.length > 0) {
      const roleLines = allRoles.map(
        (r) => `- **${r.id}**: ${r.name} — ${r.description}`,
      );
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
    const toolLines = tools.map(
      (tool) => `- **${tool.name}**: ${tool.description}`,
    );
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

    // Apply defaults for missing/optional fields (e.g. enabled: true)
    // but validate strictly afterwards — do not silently patch invalid values
    const patched = Value.Cast(RoleConfigSchema, parsed);

    // Validate the patched object
    // Cast fills in defaults but may also replace invalid values;
    // we perform a strict check and reject roles with invalid field values
    if (!Value.Check(RoleConfigSchema, patched)) {
      const errors = [...Value.Errors(RoleConfigSchema, patched)];
      logger.warn(`Role validation failed for ${filePath}: ${JSON.stringify(errors)}`);
      return null;
    }

    // Additional check: reject roles where Cast overwrote an invalid literal
    // by comparing the original parsed object's fields that must match exactly
    if (typeof parsed === 'object' && parsed !== null) {
      const original = parsed as Record<string, unknown>;
      const toolPerm = original.toolPermission as Record<string, unknown> | undefined;
      if (toolPerm && typeof toolPerm.mode === 'string') {
        const validModes = ['allowlist', 'denylist'];
        if (!validModes.includes(toolPerm.mode)) {
          logger.warn(`Role "${filePath}" has invalid toolPermission.mode: "${toolPerm.mode}" — must be 'allowlist' or 'denylist'`);
          return null;
        }
      }
    }

    return patched as RoleConfig;
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
}