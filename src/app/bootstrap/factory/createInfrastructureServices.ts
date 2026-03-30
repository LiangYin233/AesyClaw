import type { AgentRuntime, OutboundGateway } from '../../../agent/index.js';
import type { ConfigManager, RuntimeConfigStore } from '../../../features/config/index.js';
import { ChannelManager } from '../../../features/channels/ChannelManager.js';
import { setupPlugins } from '../../../features/plugins/index.js';
import type { McpClientManager } from '../../../features/mcp/index.js';
import { startConfiguredMcpServers } from '../../../features/mcp/index.js';
import type { Database } from '../../../platform/db/index.js';
import type { PluginCoordinator } from '../../../features/plugins/index.js';
import type { ToolRegistry } from '../../../platform/tools/index.js';
import { logger } from '../../../platform/observability/index.js';
import { paths } from '../../../platform/utils/paths.js';

export interface InfrastructureServices {
  pluginManager: PluginCoordinator;
  startPluginLoading: () => void;
  isPluginLoadingComplete: () => boolean;
  channelManager: ChannelManager;
  mcpManager: McpClientManager | null;
}

export async function createInfrastructureServices(args: {
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  outboundGateway: OutboundGateway;
  agentRuntime: AgentRuntime;
  workspace: string;
  tempDir: string;
  toolRegistry: ToolRegistry;
  db: Database;
}): Promise<InfrastructureServices> {
  const {
    configStore,
    configManager,
    outboundGateway,
    agentRuntime,
    workspace,
    tempDir,
    toolRegistry,
    db: _db
  } = args;

  const pluginSystem = await setupPlugins({
    workspace,
    tempDir,
    pluginsDir: paths.plugins(),
    getConfig: () => configStore.getConfig(),
    toolRegistry,
    outboundPublisher: async (message) => outboundGateway.send(message),
    updateConfig: async (mutator: (config: import('../../../types.js').Config) => import('../../../types.js').Config | void) => configManager.update(mutator),
    logger
  });

  // 使用新的 ChannelManager
  const channelManager = new ChannelManager({
    workspace,
    assetsRoot: `${workspace}/assets`,
    enableQueue: true
  });

  // 加载适配器
  await channelManager.loadAdapters();

  // 设置入站消息处理器
  channelManager.onMessage(async (message) => {
    // 转换为旧的 InboundMessage 格式供 agentRuntime 使用
    const inboundMessage = {
      id: message.id,
      channel: message.channel,
      senderId: message.senderId,
      chatId: message.chatId,
      content: message.text,
      timestamp: message.timestamp,
      messageId: message.id,
      media: message.images.map(img => img.url),
      files: message.files.map(file => ({
        name: file.name,
        url: file.url,
        type: file.type
      })),
      messageType: message.chatType,
      metadata: message.metadata
    };

    await agentRuntime.handleInbound(inboundMessage);
  });

  // 启动所有通道
  await channelManager.startAll();

  const config = configStore.getConfig();
  let mcpManager: McpClientManager | undefined;
  mcpManager = startConfiguredMcpServers({
    getMcpManager: () => mcpManager,
    setMcpManager: (manager) => {
      mcpManager = manager;
    },
    toolRegistry
  }, config) ?? undefined;

  // 设置出站网关的发送器
  outboundGateway.setDispatcher(async (message) => {
    await channelManager.dispatch(message);
  });

  return {
    pluginManager: pluginSystem.coordinator,
    startPluginLoading: pluginSystem.startLoading,
    isPluginLoadingComplete: pluginSystem.isReady,
    channelManager,
    mcpManager: mcpManager ?? null
  };
}
