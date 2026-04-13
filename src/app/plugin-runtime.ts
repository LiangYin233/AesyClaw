import { commandRegistry } from '@/features/commands/command-registry.js';
import { configManager } from '@/features/config/config-manager.js';
import { PluginManager } from '@/features/plugins/plugin-manager.js';
import { toolRegistry } from '@/platform/tools/registry.js';

export const pluginManager = new PluginManager(toolRegistry, {
  commandRegistrar: commandRegistry,
  configStore: configManager,
});
