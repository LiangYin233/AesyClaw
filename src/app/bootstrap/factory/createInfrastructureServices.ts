import type { AgentRuntime, OutboundGateway } from '../../../agent/index.js';
import type { ConfigManager, RuntimeConfigStore } from '../../../features/config/index.js';
import { ChannelManager } from '../../../features/extension/channel/ChannelManager.js';
import type { McpClientManager } from '../../../features/mcp/index.js';
import { startConfiguredMcpServers } from '../../../features/mcp/index.js';
import type { Database } from '../../../platform/db/index.js';
import type { PluginCoordinator } from '../../../features/extension/plugin/index.js';
import type { PluginSystem } from '../../../features/extension/plugin/runtime.js';
import type { ToolRegistry } from '../../../platform/tools/index.js';
import { logger } from '../../../platform/observability/index.js';

export interface InfrastructureServices {
  pluginManager: PluginCoordinator;
  startPluginLoading: () => void;
  isPluginLoadingComplete: () => boolean;
  pluginCoordinatorReady: Promise<void>;
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
  pluginSystem: PluginSystem;
}): Promise<InfrastructureServices> {
  const {
    configStore,
    configManager: _configManager,
    outboundGateway,
    agentRuntime,
    workspace,
    toolRegistry,
    pluginSystem
  } = args;

  const channelManager = new ChannelManager({
    workspace,
    assetsRoot: `${workspace}/assets`,
    enableQueue: true
  });

  await channelManager.loadAdapters();

  channelManager.onMessage(async (message) => {
    try {
      const inboundMessage: {
        id?: string;
        channel: string;
        senderId: string;
        chatId: string;
        content: string;
        timestamp: Date;
        messageId?: string;
        media?: string[];
        files?: Array<{ name: string; url: string; localPath?: string; type?: 'audio' | 'video' | 'file' | 'image' }>;
        messageType?: 'private' | 'group';
        metadata?: Record<string, unknown>;
      } = {
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
          type: file.type as 'audio' | 'video' | 'file' | 'image'
        })),
        messageType: message.chatType === 'private' ? 'private' : 'group',
        metadata: message.metadata
      };

      const processedMessage = await pluginSystem.coordinator.transformIncomingMessage(inboundMessage);

      if (processedMessage === null) {
        return;
      }

      await agentRuntime.handleInbound(processedMessage);
    } catch (error) {
      logger.error('处理入站消息失败', { error });
    }
  });

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

  outboundGateway.setDispatcher(async (message) => {
    await channelManager.dispatch(message);
  });

  return {
    pluginManager: pluginSystem.coordinator,
    startPluginLoading: pluginSystem.startLoading,
    isPluginLoadingComplete: pluginSystem.isReady,
    pluginCoordinatorReady: pluginSystem.coordinatorReady,
    channelManager,
    mcpManager: mcpManager ?? null
  };
}
