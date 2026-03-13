import type { Config } from '../../types.js';
import { ChannelManager } from '../../channels/ChannelManager.js';
import { loadExternalChannelPlugins } from '../../channels/ChannelPluginLoader.js';
import type { AgentRuntime } from '../../agent/AgentRuntime.js';
import type { OutboundGateway } from '../../agent/OutboundGateway.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { CronJob, CronService } from '../../cron/index.js';
import { MCPClientManager } from '../../mcp/index.js';
import { registerMcpTools } from './ToolIntegrationService.js';
import { createPluginManager } from './PluginRuntimeFactory.js';
import { logger } from '../../logger/index.js';
import type { SessionManager } from '../../session/index.js';

const log = logger.child({ prefix: 'InfrastructureFactory' });

async function createChannelManager(
  config: Config,
  sessionManager: SessionManager,
  workspace: string,
  agentRuntime: AgentRuntime
): Promise<ChannelManager> {
  const channelManager = new ChannelManager(sessionManager.getDatabase(), workspace);
  channelManager.setInboundHandler(async (message) => {
    await agentRuntime.handleInbound(message);
  });
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
  outboundGateway: OutboundGateway;
  agentRuntime: AgentRuntime;
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
  const { config, outboundGateway, agentRuntime, workspace, tempDir, toolRegistry, sessionManager } = args;
  const [pluginRuntime, channelManager] = await Promise.all([
    createPluginManager({
      config,
      outboundGateway,
      workspace,
      tempDir,
      toolRegistry
    }),
    createChannelManager(config, sessionManager, workspace, agentRuntime)
  ]);
  const mcpManager = createMcpManager(config, toolRegistry);
  outboundGateway.setDispatcher(async (message) => {
    await channelManager.dispatch(message);
  });

  return {
    pluginManager: pluginRuntime.pluginManager,
    startPluginLoading: pluginRuntime.startBackgroundLoading,
    channelManager,
    mcpManager
  };
}
