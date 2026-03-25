import { BuiltInCommands, type CommandRegistry } from '../../../agent/application/index.js';
import type { AgentRoleService } from '../../../agent/infrastructure/roles/AgentRoleService.js';
import type { SessionMemoryService } from '../../../agent/infrastructure/memory/SessionMemoryService.js';
import type { SessionRoutingService } from '../../../agent/infrastructure/session/SessionRoutingService.js';
import type { AgentRuntime } from '../../../agent/index.js';
import type { CronRuntimeService } from '../../../features/cron/index.js';
import type { MCPClientManager } from '../../../features/mcp/index.js';
import type { PluginManager } from '../../../features/plugins/index.js';
import { logger } from '../../../platform/observability/index.js';
import type { SessionManager } from '../../../features/sessions/index.js';
import type { SkillManager } from '../../../features/skills/index.js';
import { registerBuiltInTools } from '../../../platform/tools/index.js';
import type { ToolRegistry } from '../../../platform/tools/index.js';

const appLog = logger.child('AesyClaw');

export function registerRuntimeBindings(args: {
  commandRegistry: CommandRegistry;
  sessionManager: SessionManager;
  sessionRouting: SessionRoutingService;
  agentRoleService: AgentRoleService;
  agentRuntime: AgentRuntime;
  setPluginManager: (pluginManager: PluginManager) => void;
  pluginManager: PluginManager;
  isPluginLoadingComplete: () => boolean;
  toolRegistry: ToolRegistry;
  skillManager: SkillManager;
  cronService: CronRuntimeService;
  mcpManager: MCPClientManager | null;
  memoryService?: SessionMemoryService;
}): void {
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
    memoryService
  } = args;

  const builtInCommands = new BuiltInCommands(
    sessionManager,
    sessionRouting,
    agentRoleService,
    agentRuntime
  );
  commandRegistry.registerHandler(builtInCommands);
  appLog.info('命令注册表已初始化');

  setPluginManager(pluginManager);
  agentRoleService.setPluginLoadingStateResolver(isPluginLoadingComplete);

  registerBuiltInTools({
    toolRegistry,
    skillManager,
    cronService,
    pluginManager,
    mcpManager,
    runSubAgentTasks: (tasks, context) => agentRuntime.runSubAgentTasks(tasks, context),
    runTemporarySubAgentTask: (baseAgentName, task, systemPrompt, context) =>
      agentRuntime.runTemporarySubAgentTask(baseAgentName, task, systemPrompt, context),
    agentRoleService,
    sessionManager,
    memoryService
  });
}
