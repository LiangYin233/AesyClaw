/**
 * context — 插件的上下文工厂。
 *
 * 从 PluginManager 中提取，构建插件 init 时接收的 PluginContext。
 */

import path from 'node:path';
import { validateWithSchema } from '@aesyclaw/core/config/schema-utils';
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
          const nextPluginConfig = validatePluginConfigUpdate(definition, ref.current, configPath, value);
          await deps.configManager.set(`plugins.${pluginName}`, nextPluginConfig);
          ref.current = nextPluginConfig;
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
          if (configPath === `plugins.${pluginName}` || configPath.startsWith(`plugins.${pluginName}.`)) {
            const selfPath = configPath === `plugins.${pluginName}` ? '' : configPath.slice(`plugins.${pluginName}.`.length);
            const nextPluginConfig = validatePluginConfigUpdate(definition, ref.current, selfPath, value);
            await deps.configManager.set(`plugins.${pluginName}`, nextPluginConfig);
            ref.current = nextPluginConfig;
            return;
          }
          await deps.configManager.set(configPath, value);
        },
        update: async (update) => {
          for (const key of Object.keys(update)) {
            assertConfigPermission(definition, pluginName, 'write', key);
          }
          await deps.configManager.update(update);
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

function validatePluginConfigUpdate(
  definition: PluginDefinition,
  currentConfig: Record<string, unknown>,
  configPath: string,
  value: unknown,
): Record<string, unknown> {
  const nextConfig = structuredClone(currentConfig) as Record<string, unknown>;
  if (configPath.length === 0) {
    if (!isRecord(value)) {
      throw new Error(`插件配置(${definition.name})验证失败: 根配置必须是对象`);
    }
    for (const key of Object.keys(nextConfig)) delete nextConfig[key];
    Object.assign(nextConfig, structuredClone(value));
  } else {
    setLocalPath(nextConfig, configPath, value);
  }

  if (!definition.configSchema) return nextConfig;
  const enabled = nextConfig['enabled'];
  const businessConfig = stripEnabledField(nextConfig);
  const validatedBusiness = validateWithSchema<Record<string, unknown>>(
    definition.configSchema,
    businessConfig,
    `插件配置(${definition.name})`,
  );
  return enabled === undefined ? validatedBusiness : { ...validatedBusiness, enabled };
}

function setLocalPath(root: Record<string, unknown>, configPath: string, value: unknown): void {
  const parts = configPath.split('.').filter(Boolean);
  if (parts.length === 0) return;
  let current: Record<string, unknown> = root;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (next === undefined) {
      const created: Record<string, unknown> = {};
      current[part] = created;
      current = created;
      continue;
    }
    if (!isRecord(next) || Array.isArray(next)) {
      throw new Error(`插件配置路径 "${configPath}" 的中间节点不是对象`);
    }
    current = next;
  }
  current[parts[parts.length - 1] as string] = structuredClone(value);
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
