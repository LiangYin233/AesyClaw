import type { ToolRegistry } from './ToolRegistry.js';
import type { ToolDefinition } from '../../types.js';
import { logger } from '../observability/index.js';
import type { BuiltInLogger } from './builtins/shared.js';
import { registerMemoryTools } from './builtins/registerMemoryTools.js';
import { registerMessagingTools } from './builtins/registerMessagingTools.js';
import { registerSkillTools } from './builtins/registerSkillTools.js';

export function registerBuiltInTools(options: {
  toolRegistry: ToolRegistry;
  skillManager: object;
  cronService: object;
  pluginManager: object;
  mcpManager: object | null;
  sessionManager: object;
  memoryService?: object;
  registerCronTools?: (registry: ToolRegistry, service: object) => void;
  syncMcpTools?: (registry: ToolRegistry, manager: object, serverName: string) => void;
}): void {
  const log: BuiltInLogger = logger.child('ToolIntegration');

  if (options.registerCronTools) {
    options.registerCronTools(options.toolRegistry, options.cronService);
  }

  registerSkillTools({
    toolRegistry: options.toolRegistry,
    skillManager: options.skillManager as any
  });

  registerMessagingTools({
    toolRegistry: options.toolRegistry,
    pluginManager: options.pluginManager as any,
    sessionManager: options.sessionManager as any,
    log
  });

  registerMemoryTools({
    toolRegistry: options.toolRegistry,
    memoryService: options.memoryService as any
  });
}

export function registerMcpTools(
  toolRegistry: ToolRegistry,
  mcpManager: object,
  syncMcpTools?: (registry: ToolRegistry, manager: object, serverName: string) => void
): void {
  if (!syncMcpTools) return;
  const manager = mcpManager as any;
  manager.onToolsLoaded(async (serverName: string, _tools: ToolDefinition[]) => {
    syncMcpTools(toolRegistry, manager, serverName);
  });
}
