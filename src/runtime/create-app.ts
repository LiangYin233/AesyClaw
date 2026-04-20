import { ChatService } from '@/agent/session/session-service.js';
import { ChannelRuntime } from '@/channels/channel-runtime.js';
import { ChannelPluginManager } from '@/channels/channel-manager.js';
import { AppRuntime } from '@/runtime/app-runtime.js';
import { CommandManager } from '@/features/commands/command-registry.js';
import { configManager } from '@/features/config/config-manager.js';
import { cronService } from '@/features/cron/cron-service.js';
import { PluginManager } from '@/features/plugins/plugin-manager.js';
import { PluginRuntime } from '@/features/plugins/plugin-runtime.js';
import { roleManager } from '@/features/roles/role-manager.js';
import { SystemPromptManager } from '@/features/roles/system-prompt-manager.js';
import { skillManager } from '@/features/skills/skill-manager.js';
import { chatStore } from '@/platform/db/repositories/session-repository.js';
import { sqliteManager } from '@/platform/db/sqlite-manager.js';
import { McpRuntime } from '@/platform/tools/mcp/mcp-runtime.js';
import { ToolManager } from '@/platform/tools/registry.js';
import { pathResolver } from '@/platform/utils/paths.js';
import { getConfigSlice, onConfigSliceChange } from '@/runtime/config-slices.js';
import { CronRuntime } from '@/runtime/cron-runtime.js';
import { PipelineRuntime } from '@/runtime/pipeline-runtime.js';
import { SystemRuntime } from '@/runtime/system-runtime.js';

export function createApp(): AppRuntime {
  const toolManager = new ToolManager();
  const commandManager = new CommandManager();
  const systemPromptManager = new SystemPromptManager(toolManager);
  const pluginManager = new PluginManager({
    commandManager,
    toolManager,
    configStore: configManager,
  });

  const chatService = new ChatService({
    systemPromptManager,
    toolCatalog: toolManager,
    hookRuntime: pluginManager,
    configSource: {
      getConfig: () => configManager.config,
    },
    roleStore: roleManager,
    chatStore,
    skillStore: skillManager,
  });

  const channelManager = new ChannelPluginManager(configManager);
  const pipelineRef: { current: import('@/agent/pipeline.js').ChannelPipeline | null } = { current: null };
  const pluginRuntime = new PluginRuntime({
    pluginManager,
    configSource: {
      getPluginConfigs: () => getConfigSlice(configManager, config => config.plugins, []),
    },
  });
  const pipelineRuntime = new PipelineRuntime({
    pluginManager,
    chatService,
    commandManager,
    configManager,
    pipelineRef,
  });
  const channelRuntime = new ChannelRuntime({
    channelManager,
    configSource: {
      getChannelsConfig: () => getConfigSlice(configManager, config => config.channels, {}),
      onChannelsConfigChange: listener => onConfigSliceChange(configManager, config => config.channels, {}, listener),
      syncDefaultConfigs: () => configManager.syncAllDefaultConfigs(),
    },
    getPipeline: () => pipelineRef.current,
  });
  const mcpRuntime = new McpRuntime({
    toolManager,
    configSource: {
      getServerConfigs: () => getConfigSlice(configManager, config => config.mcp?.servers, []),
      onServerConfigChange: listener => onConfigSliceChange(configManager, config => config.mcp?.servers, [], listener),
    },
  });
  const cronRuntime = new CronRuntime({
    cronService,
    systemPromptManager,
    toolManager,
    pluginManager,
    configManager,
    roleManager,
    skillManager,
  });
  const systemRuntime = new SystemRuntime({
    toolManager,
    commandManager,
    pluginManager,
    chatService,
    configManager,
    roleManager,
    skillManager,
  });

  return new AppRuntime({
    toolManager,
    pluginRuntime,
    pipelineRuntime,
    channelRuntime,
    mcpRuntime,
    cronRuntime,
    systemRuntime,
    pathResolver,
    configManager,
    sqliteManager,
    roleManager,
    skillManager,
    chatStore,
  });
}
