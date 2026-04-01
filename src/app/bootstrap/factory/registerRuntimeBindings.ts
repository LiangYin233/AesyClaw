import { BuiltInCommands, type CommandRegistry } from '../../../agent/application/index.js';
import type { AgentRoleService } from '../../../features/agents/infrastructure/AgentRoleService.js';
import type { SessionMemoryService } from '../../../features/memory/infrastructure/SessionMemoryService.js';
import type { ISessionRouting } from '../../../agent/domain/session.js';
import type { AgentRuntime } from '../../../agent/index.js';
import { registerCronTools } from '../../../features/cron/index.js';
import type { CronRuntimeService } from '../../../features/cron/index.js';
import { syncMcpServerTools } from '../../../features/mcp/index.js';
import type { McpClientManager } from '../../../features/mcp/index.js';
import { PluginAdminService } from '../../../features/extension/plugin/index.js';
import type { PluginCoordinator } from '../../../features/extension/plugin/index.js';
import type { Config } from '../../../types.js';
import type { SessionManager } from '../../../agent/infrastructure/session/SessionManager.js';
import type { SkillManager } from '../../../features/skills/index.js';
import { registerBuiltInTools } from '../../../platform/tools/index.js';
import type { ToolRegistry } from '../../../platform/tools/index.js';

export function registerRuntimeBindings(args: {
  commandRegistry: CommandRegistry;
  sessionManager: SessionManager;
  sessionRouting: ISessionRouting;
  agentRoleService: AgentRoleService;
  agentRuntime: AgentRuntime;
  getConfig: () => Config;
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>;
  setPluginManager: (pluginManager: PluginCoordinator) => void;
  pluginManager: PluginCoordinator;
  isPluginLoadingComplete: () => boolean;
  toolRegistry: ToolRegistry;
  skillManager: SkillManager;
  cronService: CronRuntimeService;
  mcpManager: McpClientManager | null;
  memoryService?: SessionMemoryService;
}): void {
  const {
    commandRegistry,
    sessionManager,
    sessionRouting,
    agentRoleService,
    agentRuntime,
    getConfig: _getConfig,
    updateConfig: _updateConfig,
    setPluginManager,
    pluginManager,
    isPluginLoadingComplete,
    toolRegistry,
    skillManager,
    cronService,
    mcpManager,
    memoryService
  } = args;

  const pluginsService = new PluginAdminService(pluginManager, _updateConfig);
  const builtInCommands = new BuiltInCommands(
    sessionManager,
    sessionRouting,
    agentRoleService,
    agentRuntime,
    pluginsService as any
  );
  commandRegistry.registerHandler(builtInCommands);

  setPluginManager(pluginManager);
  agentRoleService.setPluginLoadingStateResolver(isPluginLoadingComplete);

  registerBuiltInTools({
    toolRegistry,
    skillManager,
    cronService,
    pluginManager,
    mcpManager,
    sessionManager,
    memoryService,
    registerCronTools: (registry, service) => registerCronTools(registry, service as any),
    syncMcpTools: (registry, manager, serverName) => syncMcpServerTools(registry, manager as any, serverName)
  });
}
