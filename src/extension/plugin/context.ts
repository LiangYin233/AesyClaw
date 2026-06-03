/**
 * context — 插件的上下文工厂。
 *
 * 从 PluginManager 中提取，构建插件 init 时接收的 PluginContext。
 */

import path from 'node:path';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { isRecord } from '@aesyclaw/core/utils';
import { stripEnabledField } from '@aesyclaw/extension/extension-utils';
import { PluginPermissionDeniedError } from './errors';
import {
  pluginOwner,
  type PluginContext,
  type PluginDefinition,
  type PluginManagerDependencies,
  type PluginPathsApi,
} from './types';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';

export function createPluginContext(
  deps: PluginManagerDependencies,
  paths: ResolvedPaths,
  definition: PluginDefinition,
  directoryName: string,
  ref: { current: Record<string, unknown> },
): PluginContext {
  const pluginName = definition.name;
  const owner = pluginOwner(pluginName);
  const log = createScopedLogger(owner);
  const pluginDir = path.join(paths.dataDir, 'extensions', directoryName);
  const pluginPaths: PluginPathsApi = {
    runtimeRoot: paths.runtimeRoot,
    dataDir: paths.dataDir,
    mediaDir: paths.mediaDir,
    workspaceDir: paths.workspaceDir,
    pluginDir,
  };

  return {
    meta: {
      name: pluginName,
      owner,
      directoryName,
    },
    log,
    paths: pluginPaths,
    config: {
      self: {
        get: (configPath) => getPath(stripEnabledField(ref.current), configPath),
        set: async (configPath, value) => {
          assertSetValue(value);
          if (configPath.length === 0) {
            await deps.configManager.set(`plugins.${pluginName}`, value);
            return;
          }
          await deps.configManager.set(`plugins.${pluginName}.${configPath}`, value);
        },
      },
      global: {
        get: (configPath) => {
          assertConfigPermission(definition, pluginName, 'read', configPath);
          return deps.configManager.get(configPath) as never;
        },
        set: async (configPath, value) => {
          assertSetValue(value);
          assertConfigPermission(definition, pluginName, 'write', configPath);
          await deps.configManager.set(configPath, value);
        },
      },
    },
    registry: {
      tools: {
        register: (tool) => {
          deps.toolRegistry.register({ ...tool, owner });
        },
      },
      commands: {
        register: (command) => {
          deps.commandRegistry.register({ ...command, scope: owner });
        },
      },
    },
    hooks: {
      register: (registration) => {
        deps.hooksBus.register({
          ...registration,
          id: scopedHookId(pluginName, registration.id),
          enabled: true,
        });
      },
      unregister: (id) => {
        deps.hooksBus.unregister(scopedHookId(pluginName, id));
      },
    },
    models: {
      resolve: (providerModel) => deps.llmAdapter.resolveModel(providerModel),
      list: async () => listConfiguredModels(deps),
    },
    control: deps.control,
  };
}

function assertSetValue(value: unknown): void {
  if (value === undefined) {
    throw new Error('Plugin config set() does not accept undefined');
  }
}

function assertConfigPermission(
  definition: PluginDefinition,
  pluginName: string,
  mode: 'read' | 'write',
  configPath: string,
): void {
  const rules = definition.permissions?.config?.[mode] ?? [];
  if (rules.some((rule) => matchesPermissionPath(rule, configPath))) return;
  throw new PluginPermissionDeniedError({
    pluginName,
    permission: `config.${mode}`,
    path: configPath,
  });
}

function matchesPermissionPath(rule: string, configPath: string): boolean {
  const ruleParts = rule.split('.').filter(Boolean);
  const pathParts = configPath.split('.').filter(Boolean);

  for (let i = 0; i < ruleParts.length; i += 1) {
    const rulePart = ruleParts[i];
    const pathPart = pathParts[i];
    if (rulePart === '*') {
      if (pathPart === undefined) return false;
      if (i === ruleParts.length - 1) return true;
      continue;
    }
    if (rulePart !== pathPart) return false;
  }

  return ruleParts.length === pathParts.length;
}

function scopedHookId(pluginName: string, id: string): string {
  return `plugin:${pluginName}:${id}`;
}

function getPath<T = unknown>(source: Record<string, unknown>, configPath: string): T | undefined {
  if (configPath.length === 0) return source as T;
  let current: unknown = source;
  for (const part of configPath.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current === undefined ? undefined : (structuredClone(current) as T);
}

function listConfiguredModels(deps: PluginManagerDependencies): Array<{
  id: string;
  provider: string;
  model: string;
}> {
  const providers = deps.configManager.get('providers');
  if (!isRecord(providers)) return [];
  const result: Array<{ id: string; provider: string; model: string }> = [];
  for (const [provider, providerConfig] of Object.entries(providers)) {
    if (!isRecord(providerConfig) || !isRecord(providerConfig['models'])) continue;
    for (const model of Object.keys(providerConfig['models'])) {
      result.push({ id: `${provider}/${model}`, provider, model });
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
