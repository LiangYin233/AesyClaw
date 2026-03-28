import type { ToolRegistry } from './ToolRegistry.js';
import type { SkillManager } from '../../features/skills/index.js';
import type { CronRuntimeService } from '../../features/cron/index.js';
import type { McpClientManager } from '../../features/mcp/index.js';
import type { PluginManager } from '../../features/plugins/index.js';
import type { ToolDefinition } from '../../types.js';
import type { SessionMemoryService } from '../../agent/infrastructure/memory/SessionMemoryService.js';
import type { SessionManager } from '../../features/sessions/index.js';
import { registerCronTools } from '../../features/cron/index.js';
import { syncMcpServerTools } from '../../features/mcp/index.js';
import { logger } from '../observability/index.js';
import type { BuiltInLogger } from './builtins/shared.js';
import { registerMemoryTools } from './builtins/registerMemoryTools.js';
import { registerMessagingTools } from './builtins/registerMessagingTools.js';
import { registerSkillTools } from './builtins/registerSkillTools.js';

export interface ToolIntegrationOptions {
  toolRegistry: ToolRegistry;
  skillManager: SkillManager;
  cronService: CronRuntimeService;
  pluginManager: PluginManager;
  mcpManager: McpClientManager | null;
  sessionManager: SessionManager;
  memoryService?: SessionMemoryService;
}

export function registerBuiltInTools(options: ToolIntegrationOptions): void {
  const log: BuiltInLogger = logger.child('ToolIntegration');

  registerCronTools(options.toolRegistry, options.cronService);

  registerSkillTools({
    toolRegistry: options.toolRegistry,
    skillManager: options.skillManager
  });

  registerMessagingTools({
    toolRegistry: options.toolRegistry,
    pluginManager: options.pluginManager,
    sessionManager: options.sessionManager,
    log
  });

  registerMemoryTools({
    toolRegistry: options.toolRegistry,
    memoryService: options.memoryService
  });
}

export function registerMcpTools(toolRegistry: ToolRegistry, mcpManager: McpClientManager): void {
  mcpManager.onToolsLoaded(async (serverName: string, _tools: ToolDefinition[]) => {
    syncMcpServerTools(toolRegistry, mcpManager, serverName);
  });
}
