import type { ToolRegistry } from './ToolRegistry.js';
import type { ToolDefinition } from '../../types.js';
import { registerCronTools } from '../../features/cron/index.js';
import { syncMcpServerTools } from '../../features/mcp/index.js';
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
}): void {
  const log: BuiltInLogger = logger.child('ToolIntegration');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerCronTools(options.toolRegistry, options.cronService as any);

  registerSkillTools({
    toolRegistry: options.toolRegistry,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    skillManager: options.skillManager as any
  });

  registerMessagingTools({
    toolRegistry: options.toolRegistry,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pluginManager: options.pluginManager as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessionManager: options.sessionManager as any,
    log
  });

  registerMemoryTools({
    toolRegistry: options.toolRegistry,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    memoryService: options.memoryService as any
  });
}

export function registerMcpTools(
  toolRegistry: ToolRegistry,
  mcpManager: object
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manager = mcpManager as any;
  manager.onToolsLoaded(async (serverName: string, _tools: ToolDefinition[]) => {
    syncMcpServerTools(toolRegistry, manager, serverName);
  });
}
