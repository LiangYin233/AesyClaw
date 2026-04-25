/**
 * ConfigManager — loads, validates, hot-reloads, and notifies on configuration changes.
 *
 * Key behaviours:
 * - Loads config from JSON file; creates default if missing
 * - TypeBox validation with fallback to defaults for missing fields
 * - `subscribe(key)` / `subscribeAll()` for change notifications
 * - `update(partial)` merges and persists; sets `selfUpdating` guard to prevent
 *   infinite reload loops from `fs.watch`
 * - `registerDefaults` / `syncDefaults` for subsystems to declare default values
 */

import fs from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import type { DeepPartial, ConfigChangeListener, Unsubscribe } from '../types';
import { createScopedLogger } from '../logger';
import { ConfigValidationError } from '../errors';
import { AppConfigSchema } from './schema';
import type { AppConfig } from './schema';
import { DEFAULT_CONFIG } from './defaults';

const logger = createScopedLogger('config');

type ListenerEntry = {
  key?: keyof AppConfig;
  listener: ConfigChangeListener<unknown>;
};

export class ConfigManager {
  private config: AppConfig | null = null;
  private configPath: string | null = null;
  private listeners: ListenerEntry[] = [];
  private registeredDefaults: Map<string, Record<string, unknown>> = new Map();
  private selfUpdating = false;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 300;

  // ─── Lifecycle ────────────────────────────────────────────────

  /**
   * Load configuration from the given path.
   * If the file does not exist, creates it with default values.
   */
  async load(configPath: string): Promise<void> {
    this.configPath = configPath;

    if (!fs.existsSync(configPath)) {
      logger.info('Config file not found, creating with defaults', { path: configPath });
      this.config = structuredClone(DEFAULT_CONFIG);
      await this.persistConfig();
    } else {
      logger.info('Loading config', { path: configPath });
      const raw = fs.readFileSync(configPath, 'utf-8');
      this.config = this.parseAndValidate(raw);
    }
  }

  // ─── Read ──────────────────────────────────────────────────────

  /** Get a read-only snapshot of the entire config */
  getConfig(): Readonly<AppConfig> {
    if (!this.config) {
      throw new ConfigValidationError('Config not loaded', null);
    }
    return this.config;
  }

  /** Get a read-only snapshot of a specific config section */
  get<K extends keyof AppConfig>(key: K): Readonly<AppConfig[K]> {
    if (!this.config) {
      throw new ConfigValidationError('Config not loaded', null);
    }
    return this.config[key];
  }

  // ─── Subscribe ─────────────────────────────────────────────────

  /** Subscribe to changes on a specific config key */
  subscribe<K extends keyof AppConfig>(
    key: K,
    listener: ConfigChangeListener<AppConfig[K]>,
  ): Unsubscribe {
    const entry: ListenerEntry = { key, listener: listener as ConfigChangeListener<unknown> };
    this.listeners.push(entry);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== entry);
    };
  }

  /** Subscribe to any config change */
  subscribeAll(listener: ConfigChangeListener<AppConfig>): Unsubscribe {
    const entry: ListenerEntry = { listener: listener as ConfigChangeListener<unknown> };
    this.listeners.push(entry);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== entry);
    };
  }

  // ─── Write ─────────────────────────────────────────────────────

  /**
   * Merge a partial config into the current state and persist to disk.
   * Sets the `selfUpdating` guard so the resulting file-write does not
   * trigger a redundant reload cycle.
   */
  async update(partial: DeepPartial<AppConfig>): Promise<void> {
    if (!this.config || !this.configPath) {
      throw new ConfigValidationError('Config not loaded', null);
    }

    const oldConfig = structuredClone(this.config);
    this.config = this.deepMerge(
      this.config,
      partial as Partial<AppConfig> & DeepPartial<AppConfig>,
    );

    // Set guard before writing to disk
    this.selfUpdating = true;
    try {
      await this.persistConfig();
    } finally {
      // Clear guard after a short delay to let fs.watch events settle
      setTimeout(() => {
        this.selfUpdating = false;
      }, this.DEBOUNCE_MS + 50);
    }

    this.notifyListeners(oldConfig);
  }

  // ─── Defaults ──────────────────────────────────────────────────

  /**
   * Register default values for a subsystem.
   * These are synced into config via `syncDefaults()`.
   */
  registerDefaults(key: string, defaults: Record<string, unknown>): void {
    this.registeredDefaults.set(key, defaults);
  }

  /**
   * Merge all registered defaults into the current config and persist.
   * Typically called at the end of startup after all subsystems have
   * registered their defaults.
   */
  async syncDefaults(): Promise<void> {
    if (!this.config || !this.configPath) {
      throw new ConfigValidationError('Config not loaded', null);
    }

    const oldConfig = structuredClone(this.config);

    for (const [key, defaults] of this.registeredDefaults) {
      // Support dot-notation keys like 'channels.testchannel'
      const nestedPartial = this.buildNestedObject(key, defaults);
      this.config = this.deepMerge(
        this.config,
        nestedPartial as Partial<AppConfig> & DeepPartial<AppConfig>,
      );
    }

    this.selfUpdating = true;
    try {
      await this.persistConfig();
    } finally {
      setTimeout(() => {
        this.selfUpdating = false;
      }, this.DEBOUNCE_MS + 50);
    }

    this.notifyListeners(oldConfig);
  }

  // ─── Hot reload ─────────────────────────────────────────────────

  /** Start watching the config file for external changes */
  startHotReload(): void {
    if (!this.configPath) {
      throw new ConfigValidationError('Config not loaded — cannot start hot reload', null);
    }

    if (this.watcher) {
      return; // Already watching
    }

    this.watcher = fs.watch(this.configPath, () => {
      this.handleFileChange();
    });

    // Also listen for the 'error' event to prevent crashing
    this.watcher.on('error', (err) => {
      logger.error('Config file watcher error', err);
    });

    logger.info('Hot reload watcher started');
  }

  /** Stop watching the config file */
  stopHotReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('Hot reload watcher stopped');
    }
  }

  // ─── Private helpers ───────────────────────────────────────────

  private handleFileChange(): void {
    // Skip if we just wrote the file ourselves
    if (this.selfUpdating) {
      return;
    }

    // Debounce: coalesce rapid change events
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.reloadFromFile();
    }, this.DEBOUNCE_MS);
  }

  private reloadFromFile(): void {
    if (!this.configPath) return;

    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const newConfig = this.parseAndValidate(raw);

      // Compare normalised JSON to detect real changes
      const oldNormalised = JSON.stringify(this.config);
      const newNormalised = JSON.stringify(newConfig);

      if (oldNormalised === newNormalised) {
        logger.debug('Config file changed but content is identical — skipping');
        return;
      }

      const oldConfig = this.config;
      if (!oldConfig) {
        this.config = newConfig;
        logger.info('Config reloaded from file');
        return;
      }
      this.config = newConfig;
      this.notifyListeners(oldConfig);
      logger.info('Config reloaded from file');
    } catch (err) {
      logger.error('Failed to reload config file', err);
    }
  }

  private parseAndValidate(raw: string): AppConfig {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ConfigValidationError('Invalid JSON in config file', err);
    }

    // Validate with TypeBox
    if (!Value.Check(AppConfigSchema, parsed)) {
      // Attempt to fill missing fields with defaults
      const patched = Value.Cast(AppConfigSchema, parsed);

      // Validate again after patching
      if (!Value.Check(AppConfigSchema, patched)) {
        const errors = [...Value.Errors(AppConfigSchema, patched)];
        throw new ConfigValidationError('Config validation failed', errors);
      }

      logger.warn('Config had missing fields — patched with defaults');
      return patched as AppConfig;
    }

    return parsed as AppConfig;
  }

  private async persistConfig(): Promise<void> {
    if (!this.configPath) return;
    const json = JSON.stringify(this.config, null, 2);
    mkdirSync(dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, json, 'utf-8');
  }

  private notifyListeners(oldConfig: AppConfig): void {
    const newConfig = this.config;
    if (!newConfig) {
      return;
    }

    for (const entry of this.listeners) {
      try {
        let result: void | Promise<void> = undefined;
        if (entry.key) {
          // Key-specific listener
          const oldVal = oldConfig[entry.key];
          const newVal = newConfig[entry.key];
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            result = (entry.listener as ConfigChangeListener<unknown>)(newVal, oldVal);
          }
        } else {
          // Global listener
          result = (entry.listener as ConfigChangeListener<AppConfig>)(newConfig, oldConfig);
        }

        if (isPromiseLike(result)) {
          result.catch((err: unknown) => {
            logger.error('Error in async config change listener', err);
          });
        }
      } catch (err) {
        logger.error('Error in config change listener', err);
      }
    }
  }

  /**
   * Deep merge source into target. Source values override target values.
   * Arrays are replaced, not concatenated.
   */
  private deepMerge<T extends Record<string, unknown>>(
    target: T,
    source: Partial<T> & DeepPartial<T>,
  ): T {
    const result = structuredClone(target) as Record<string, unknown>;

    for (const key of Object.keys(source)) {
      const sourceVal = (source as Record<string, unknown>)[key];
      const targetVal = result[key];

      if (
        sourceVal !== null &&
        typeof sourceVal === 'object' &&
        !Array.isArray(sourceVal) &&
        targetVal !== null &&
        typeof targetVal === 'object' &&
        !Array.isArray(targetVal)
      ) {
        result[key] = this.deepMerge(
          targetVal as Record<string, unknown>,
          sourceVal as Record<string, unknown>,
        );
      } else {
        result[key] = sourceVal as unknown;
      }
    }

    return result as T;
  }

  /**
   * Convert a dot-notation key like 'channels.testchannel' and a value
   * into a nested object: { channels: { testchannel: value } }
   */
  private buildNestedObject(key: string, value: Record<string, unknown>): Record<string, unknown> {
    const parts = key.split('.');
    const result: Record<string, unknown> = {};
    let current = result;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        current[part] = value;
      } else {
        current[part] = {};
        current = current[part] as Record<string, unknown>;
      }
    }

    return result;
  }
}

function isPromiseLike(value: unknown): value is Promise<void> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { catch?: unknown }).catch === 'function'
  );
}
