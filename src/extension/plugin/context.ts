/**
 * context — 插件的上下文工厂。
 *
 * 从 PluginManager 中提取，构建插件 init 时接收的 PluginContext。
 */

import path from 'node:path';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { isRecord } from '@aesyclaw/core/utils';
import { createPluginConfigApi } from './config-api';
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
    config: createPluginConfigApi(deps, definition, ref),
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

function scopedHookId(pluginName: string, id: string): string {
  return `plugin:${pluginName}:${id}`;
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
