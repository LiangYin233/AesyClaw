import type { Config } from '../../types.js';
import type { EventBus } from '../../bus/EventBus.js';
import { ChannelManager, loadExternalChannelPlugins } from '../../channels/index.js';
import type { AgentLoop } from '../../agent/index.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { CronJob, CronService } from '../../cron/index.js';
import { MCPClientManager } from '../../mcp/index.js';
import { registerMcpTools } from './ToolIntegrationService.js';
import { createPluginManager } from './PluginRuntimeFactory.js';
import { logger } from '../../logger/index.js';

const log = logger.child({ prefix: 'InfrastructureFactory' });

async function createChannelManager(config: Config, eventBus: EventBus, workspace: string): Promise<ChannelManager> {
  const channelManager = new ChannelManager(eventBus, workspace);
  await loadExternalChannelPlugins(channelManager, process.cwd());

  for (const [channelName, channelConfig] of Object.entries(config.channels as Record<string, { enabled?: boolean }>)) {
    if (!channelConfig?.enabled) {
      continue;
    }

    const channel = channelManager.createChannel(channelName, channelConfig);
    if (channel) {
      log.info(`Channel enabled: ${channelName}`);
    } else {
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
  agent: AgentLoop;
  workspace: string;
  tempDir: string;
  toolRegistry: ToolRegistry;
  cronService: CronService;
  onCronJob?: (job: CronJob) => Promise<void>;
}): Promise<{
  pluginManager: Awaited<ReturnType<typeof createPluginManager>>;
  channelManager: ChannelManager;
  mcpManager: MCPClientManager | null;
}> {
  const { config, eventBus, agent, workspace, tempDir, toolRegistry } = args;
  const pluginManager = await createPluginManager({
    config,
    eventBus,
    agent,
    workspace,
    tempDir,
    toolRegistry
  });
  const channelManager = await createChannelManager(config, eventBus, workspace);
  const mcpManager = createMcpManager(config, toolRegistry);

  return {
    pluginManager,
    channelManager,
    mcpManager
  };
}
