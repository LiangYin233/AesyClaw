/**
 * Plugin interface definitions.
 *
 * Plugins are external modules under `extension/plugin_*` that receive a
 * scoped context and can register tools, commands, and pipeline hooks.
 */

import type { CommandDefinition, DeepPartial } from '../core/types';
import type { Logger } from '../core/logger';
import type { AppConfig, PluginConfigEntry } from '../core/config/schema';
import type { AesyClawTool } from '../tool/tool-registry';
import type { ToolRegistry } from '../tool/tool-registry';
import type { CommandRegistry } from '../command/command-registry';
import type { HookDispatcher } from '../pipeline/hook-dispatcher';
import type { PluginHooks } from '../pipeline/middleware/types';

export type PluginOwner = `plugin:${string}`;

export interface PluginContext {
  config: Record<string, unknown>;
  registerTool(tool: AesyClawTool): void;
  unregisterTool(name: string): void;
  registerCommand(command: CommandDefinition): void;
  logger: Logger;
}

export interface PluginDefinition {
  name: string;
  version: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  init(ctx: PluginContext): Promise<void>;
  destroy?(): Promise<void>;
  hooks?: PluginHooks;
}

export interface LoadedPlugin {
  definition: PluginDefinition;
  directory: string;
  directoryName: string;
  owner: PluginOwner;
  config: Record<string, unknown>;
  loadedAt: Date;
}

export type PluginLifecycleState = 'loaded' | 'disabled' | 'unloaded' | 'failed';

export interface PluginStatus {
  name: string;
  directoryName: string;
  version?: string;
  description?: string;
  enabled: boolean;
  state: PluginLifecycleState;
  directory: string;
  error?: string;
}

export interface PluginModule {
  definition: PluginDefinition;
  directory: string;
  directoryName: string;
  entryPath: string;
}

export interface PluginLoaderOptions {
  extensionDir?: string;
}

export interface PluginManagerDependencies {
  configManager: PluginConfigManagerLike;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  hookDispatcher: HookDispatcher;
  pluginLoader?: PluginLoaderLike;
}

export interface PluginConfigManagerLike {
  get(key: 'plugins'): ReadonlyArray<Readonly<PluginConfigEntry>>;
  update(partial: DeepPartial<Pick<AppConfig, 'plugins'>>): Promise<void>;
}

export interface PluginLoaderLike {
  discover(): Promise<string[]>;
  load(pluginDir: string): Promise<PluginModule>;
}

export interface PluginConfigLookup {
  entry?: Readonly<PluginConfigEntry>;
  enabled: boolean;
  options: Record<string, unknown>;
}

export { type PluginHooks };

export function pluginOwner(pluginName: string): PluginOwner {
  return `plugin:${pluginName}`;
}

export function isPluginDefinition(value: unknown): value is PluginDefinition {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    typeof value.init === 'function' &&
    (value.destroy === undefined || typeof value.destroy === 'function') &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.defaultConfig === undefined || isRecord(value.defaultConfig))
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
