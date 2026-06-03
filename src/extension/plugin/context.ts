/**
 * context — 插件的上下文工厂。
 *
 * 从 PluginManager 中提取，构建插件 init 时接收的 PluginContext。
 */

import { createScopedLogger } from '@aesyclaw/core/logger';
import {
  createScopedRegistryActions,
  stripEnabledField,
} from '@aesyclaw/extension/extension-utils';
import { pluginOwner, type PluginContext, type PluginManagerDependencies } from './types';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';

export function createPluginContext(
  deps: PluginManagerDependencies,
  paths: ResolvedPaths,
  pluginName: string,
  ref: { current: Record<string, unknown> },
  state: Record<string, unknown>,
): PluginContext {
  const owner = pluginOwner(pluginName);
  const registryActions = createScopedRegistryActions(deps, owner);
  return {
    name: pluginName,
    get config() {
      // 插件上下文中剥离 enabled 字段
      return stripEnabledField(ref.current);
    },
    paths,
    configManager: deps.configManager,
    control: deps.control,
    ...registryActions,
    logger: createScopedLogger(owner),
    state,
    resolveModel: (providerModel) => deps.llmAdapter.resolveModel(providerModel),
  };
}
