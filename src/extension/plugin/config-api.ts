import { validateWithSchema } from '@aesyclaw/core/config/schema-utils';
import { ErrorFactory } from '@aesyclaw/core/errors';
import { isRecord } from '@aesyclaw/core/utils';
import { stripEnabledField } from '@aesyclaw/extension/extension-utils';
import { PluginPermissionDeniedError } from './errors';
import type { PluginConfigApi, PluginDefinition, PluginManagerDependencies } from './types';

export function createPluginConfigApi(
  deps: PluginManagerDependencies,
  definition: PluginDefinition,
  ref: { current: Record<string, unknown> },
): PluginConfigApi {
  const pluginName = definition.name;

  return {
    self: {
      get: (configPath) => getPath(stripEnabledField(ref.current), configPath),
      set: async (configPath, value) => {
        assertSetValue(value, configPath);
        const nextPluginConfig = validatePluginConfigUpdate(
          definition,
          ref.current,
          configPath,
          value,
        );
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
        assertSetValue(value, configPath);
        assertConfigPermission(definition, pluginName, 'write', configPath);
        if (
          configPath === `plugins.${pluginName}` ||
          configPath.startsWith(`plugins.${pluginName}.`)
        ) {
          const selfPath =
            configPath === `plugins.${pluginName}`
              ? ''
              : configPath.slice(`plugins.${pluginName}.`.length);
          const nextPluginConfig = validatePluginConfigUpdate(
            definition,
            ref.current,
            selfPath,
            value,
          );
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
  };
}

function assertSetValue(value: unknown, configPath: string): void {
  if (value === undefined) {
    throw ErrorFactory.config.invalid('Plugin config set() does not accept undefined', {
      configPath: configPath.length === 0 ? '<root>' : configPath,
    });
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
      throw ErrorFactory.config.invalid(`插件配置(${definition.name})验证失败: 根配置必须是对象`, {
        configPath: `plugins.${definition.name}`,
      });
    }
    const managedEnabled = nextConfig['enabled'];
    for (const key of Object.keys(nextConfig)) delete nextConfig[key];
    Object.assign(nextConfig, structuredClone(value));
    if (managedEnabled !== undefined && nextConfig['enabled'] === undefined) {
      nextConfig['enabled'] = managedEnabled;
    }
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
      throw ErrorFactory.config.invalid(`插件配置路径 "${configPath}" 的中间节点不是对象`, {
        configPath,
      });
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

function getPath<T = unknown>(source: Record<string, unknown>, configPath: string): T | undefined {
  if (configPath.length === 0) return source as T;
  let current: unknown = source;
  for (const part of configPath.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current === undefined ? undefined : (structuredClone(current) as T);
}
