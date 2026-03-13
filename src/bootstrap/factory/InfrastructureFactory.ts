import type { Config } from '../../types.js';
import type { EventBus } from '../../bus/EventBus.js';
import { ChannelManager } from '../../channels/ChannelManager.js';
import { loadExternalChannelPlugins } from '../../channels/ChannelPluginLoader.js';
import type { AgentLoop } from '../../agent/core/AgentLoop.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { CronJob, CronService } from '../../cron/index.js';
import { MCPClientManager } from '../../mcp/index.js';
import { registerMcpTools } from './ToolIntegrationService.js';
import { createPluginManager } from './PluginRuntimeFactory.js';
import { logger } from '../../logger/index.js';
import type { SessionManager } from '../../session/index.js';

const log = logger.child({ prefix: 'InfrastructureFactory' });

async function createChannelManager(config: Config, eventBus: EventBus, sessionManager: SessionManager, workspace: string): Promise<ChannelManager> {
  const channelManager = new ChannelManager(eventBus, sessionManager.getDatabase(), workspace);
  await loadExternalChannelPlugins(channelManager, process.cwd());

  for (const [channelName, channelConfig] of Object.entries(config.channels as Record<string, { enabled?: boolean }>)) {
    if (!channelConfig?.enabled) {
      continue;
    }

    const channel = channelManager.createChannel(channelName, channelConfig);
    if (!channel) {
      log.warn(`Channel plugin not found: ${channelName}`);
    }
  }

  return channelManager;
}

function createMcpManager(config: Config, toolRegistry: ToolRegistry): MCPClientManager | null {
  if (!config.mcp || Object.keys(config.mcp).length === 0) {
    return null;
  }

  const mcpManager = new MCPClientManager();
  registerMcpTools(toolRegistry, mcpManager);
  mcpManager.connectAsync(config.mcp);
  log.info('MCP servers connecting in background...');
  return mcpManager;
}

export async function createInfrastructure(args: {
  config: Config;
  eventBus: EventBus;
  workspace: string;
  tempDir: string;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
  cronService: CronService;
  onCronJob?: (job: CronJob) => Promise<void>;
}): Promise<{
  pluginManager: Awaited<ReturnType<typeof createPluginManager>>['pluginManager'];
  startPluginLoading: Awaited<ReturnType<typeof createPluginManager>>['startBackgroundLoading'];
  channelManager: ChannelManager;
  mcpManager: MCPClientManager | null;
}> {
  const { config, eventBus, workspace, tempDir, toolRegistry, sessionManager } = args;
  const [pluginRuntime, channelManager] = await Promise.all([
    createPluginManager({
      config,
      eventBus,
      workspace,
      tempDir,
      toolRegistry
    }),
    createChannelManager(config, eventBus, sessionManager, workspace)
  ]);
  const mcpManager = createMcpManager(config, toolRegistry);

  return {
    pluginManager: pluginRuntime.pluginManager,
    startPluginLoading: pluginRuntime.startBackgroundLoading,
    channelManager,
    mcpManager
  };
}
