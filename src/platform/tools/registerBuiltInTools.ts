import type { ToolRegistry } from './ToolRegistry.js';
import type { SkillManager } from '../../features/skills/index.js';
import type { CronRuntimeService } from '../../features/cron/index.js';
import type { McpClientManager } from '../../features/mcp/index.js';
import type { PluginManager } from '../../features/plugins/index.js';
import type { ToolDefinition } from '../../types.js';
import type { AgentRoleService } from '../../agent/infrastructure/roles/AgentRoleService.js';
import type { SessionMemoryService } from '../../agent/infrastructure/memory/SessionMemoryService.js';
import type { SessionManager } from '../../features/sessions/index.js';
import { registerCronTools } from '../../features/cron/index.js';
import { syncMcpServerTools } from '../../features/mcp/index.js';
import { logger } from '../observability/index.js';
import type { BuiltInLogger } from './builtins/shared.js';
import { registerAgentTools } from './builtins/registerAgentTools.js';
import { registerMemoryTools } from './builtins/registerMemoryTools.js';
import { registerMessagingTools } from './builtins/registerMessagingTools.js';
import { registerSkillTools } from './builtins/registerSkillTools.js';

export interface ToolIntegrationOptions {
  toolRegistry: ToolRegistry;
  skillManager: SkillManager;
  cronService: CronRuntimeService;
  pluginManager: PluginManager;
  mcpManager: McpClientManager | null;
  runSubAgentTasks: (
    tasks: Array<{ agentName: string; task: string }>,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ) => Promise<Array<{ agentName: string; task: string; success: boolean; result?: string; error?: string }>>;
  runTemporarySubAgentTask: (
    baseAgentName: string | undefined,
    task: string,
    systemPrompt: string,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ) => Promise<string>;
  agentRoleService: AgentRoleService;
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

  registerAgentTools({
    toolRegistry: options.toolRegistry,
    runSubAgentTasks: options.runSubAgentTasks,
    runTemporarySubAgentTask: options.runTemporarySubAgentTask,
    agentRoleService: options.agentRoleService,
    log
  });

  registerMemoryTools({
    toolRegistry: options.toolRegistry,
    memoryService: options.memoryService,
    log
  });

  const skills = options.skillManager.listSkills();
  if (skills.length > 0) {
    log.info('技能工具已注册', {
      skillCount: skills.length,
      skills: skills.map((skill) => skill.name)
    });
  }
}

export function registerMcpTools(toolRegistry: ToolRegistry, mcpManager: McpClientManager): void {
  const log = logger.child('ToolIntegration');

  mcpManager.onToolsLoaded(async (serverName: string, _tools: ToolDefinition[]) => {
    const toolCount = syncMcpServerTools(toolRegistry, mcpManager, serverName);
    log.info('MCP 工具已注册', { server: serverName, toolCount });
  });
}
