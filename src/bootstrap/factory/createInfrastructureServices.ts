import type { AgentRuntime, OutboundGateway } from '../../agent/index.js';
import type { ConfigManager, RuntimeConfigStore } from '../../config/index.js';
import { createChannelRuntime } from '../../features/channels/createChannelRuntime.js';
import { createPluginRuntime } from '../../features/plugins/createPluginRuntime.js';
import type { MCPClientManager } from '../../mcp/index.js';
import { startConfiguredMcpServers } from '../../mcp/runtime.js';
import type { PluginManager } from '../../plugins/index.js';
import type { SessionManager } from '../../session/index.js';
import type { ToolRegistry } from '../../tools/index.js';

export interface InfrastructureServices {
  pluginManager: PluginManager;
  startPluginLoading: () => void;
  isPluginLoadingComplete: () => boolean;
  channelManager: Awaited<ReturnType<typeof createChannelRuntime>>;
  mcpManager: MCPClientManager | null;
}

export async function createInfrastructureServices(args: {
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  outboundGateway: OutboundGateway;
  agentRuntime: AgentRuntime;
  workspace: string;
  tempDir: string;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
}): Promise<InfrastructureServices> {
  const {
    configStore,
    configManager,
    outboundGateway,
    agentRuntime,
    workspace,
    tempDir,
    toolRegistry,
    sessionManager
  } = args;

  const [pluginRuntime, channelManager] = await Promise.all([
    createPluginRuntime({
      configStore,
      outboundGateway,
      workspace,
      tempDir,
      toolRegistry,
      updateConfig: (mutator) => configManager.update(mutator)
    }),
    createChannelRuntime({
      configStore,
      configManager,
      sessionManager,
      workspace,
      agentRuntime
    })
  ]);

  const config = configStore.getConfig();
  let mcpManager: MCPClientManager | undefined;
  mcpManager = startConfiguredMcpServers({
    getMcpManager: () => mcpManager,
    setMcpManager: (manager) => {
      mcpManager = manager;
    },
    toolRegistry
  }, config) ?? undefined;

  outboundGateway.setDispatcher(async (message) => {
    await channelManager.dispatch(message);
  });

  return {
    pluginManager: pluginRuntime.pluginManager,
    startPluginLoading: pluginRuntime.startBackgroundLoading,
    isPluginLoadingComplete: pluginRuntime.isBackgroundLoadingComplete,
    channelManager,
    mcpManager: mcpManager ?? null
  };
}
