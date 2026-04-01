import type { AgentRuntime } from '../../../agent/index.js';
import { BuiltInCommands } from '../../../agent/application/index.js';
import type { ISessionRouting } from '../../../agent/domain/session.js';
import { registerBuiltInTools } from '../../../platform/tools/index.js';
import type { ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import type { SessionManager } from '../../../agent/infrastructure/session/SessionManager.js';
import { PluginCoordinator } from '../../../features/extension/plugin/index.js';
import { PluginAdminService } from '../../../features/extension/plugin/index.js';
import { SkillManager } from '../../../features/skills/index.js';
import type { CronRuntimeService } from '../../../features/cron/index.js';
import { registerCronTools } from '../../../features/cron/index.js';
import type { McpClientManager } from '../../../features/mcp/index.js';
import { syncMcpServerTools } from '../../../features/mcp/index.js';
import type { Config } from '../../../types.js';

export interface RegisterRuntimeBindingsArgs {
  commandRegistry: any;
  sessionManager: SessionManager;
  sessionRouting: ISessionRouting;
  agentRoleService: any;
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
  memoryService?: any;
}

export function registerRuntimeBindings(args: RegisterRuntimeBindingsArgs): void {
  const { 
    commandRegistry,
    sessionManager,
    sessionRouting,
    agentRoleService,
    agentRuntime,
    setPluginManager,
    pluginManager,
    isPluginLoadingComplete,
    toolRegistry,
    skillManager,
    cronService,
    mcpManager,
    memoryService,
    updateConfig
  } = args;

  const pluginsService = new PluginAdminService(pluginManager, updateConfig);
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
    registerCronTools: (registry: any, service: any) => registerCronTools(registry, service as any),
    syncMcpTools: (registry: any, manager: any, serverName: string) => syncMcpServerTools(registry, manager as any, serverName)
  });
}
