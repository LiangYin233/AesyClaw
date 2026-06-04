import path from 'node:path';
import { validateWithSchema } from '@aesyclaw/core/config/schema-utils';
import type { ExtensionRuntimeSpec } from '@aesyclaw/extension/spec';
import { stripEnabledField } from '@aesyclaw/extension/extension-utils';
import { createPluginContext } from './context';
import { discoverPluginDefinition } from './types';
import type { PluginContext, PluginDefinition, PluginManagerDependencies } from './types';

export function createPluginSpec(
  deps: PluginManagerDependencies,
): ExtensionRuntimeSpec<PluginDefinition, PluginContext> {
  return {
    kind: 'plugin',
    configKey: 'plugins',
    dirPrefix: 'plugin_',
    extensionsDir: deps.paths.extensionsDir,
    discoverDefinition: discoverPluginDefinition,
    createContext: ({ definition, ref, directory }) => {
      const directoryName = directory ? path.basename(directory) : `plugin_${definition.name}`;
      return createPluginContext(deps, deps.paths, definition, directoryName, ref);
    },
    validateConfig: (definition, config) => {
      if (!definition.configSchema) return config;
      const enabled = config['enabled'];
      const validated = validateWithSchema<Record<string, unknown>>(
        definition.configSchema,
        stripEnabledField(config),
        `plugin配置(${definition.name})`,
      );
      return enabled === undefined ? validated : { ...validated, enabled };
    },
    getManagedDefaults: () => ({ enabled: true }),
    onBeforeUnload: (definition) => {
      deps.hooksBus.unregisterByPrefix(`plugin:${definition.name}:`);
    },
  };
}
