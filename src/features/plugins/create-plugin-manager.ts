import { PluginManager, type PluginManagerDependencies } from './plugin-manager.js';
import { ToolRegistry } from '@/platform/tools/registry.js';

export function createPluginManager(
  toolRegistry: ToolRegistry,
  deps: PluginManagerDependencies
): PluginManager {
  return new PluginManager(toolRegistry, deps);
}
