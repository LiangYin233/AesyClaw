import { ChatService } from '@/agent/session/session-service.js';
import { ChannelPluginManager } from '@/channels/channel-manager.js';
import { configManager } from '@/features/config/config-manager.js';
import { cronService } from '@/features/cron/cron-service.js';
import { PluginManager } from '@/features/plugins/plugin-manager.js';
import { roleManager } from '@/features/roles/role-manager.js';
import { SystemPromptManager } from '@/features/roles/system-prompt-manager.js';
import { skillManager } from '@/features/skills/skill-manager.js';
import { chatStore } from '@/platform/db/repositories/session-repository.js';
import { sqliteManager } from '@/platform/db/sqlite-manager.js';
import { ToolManager } from '@/platform/tools/registry.js';
import { CommandManager } from '@/features/commands/command-registry.js';
import { AppRuntime } from '@/app-runtime.js';
import { pathResolver } from '@/platform/utils/paths.js';

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

  return new AppRuntime({
    toolManager,
    commandManager,
    systemPromptManager,
    pluginManager,
    chatService,
    channelManager,
    pathResolver,
    configManager,
    sqliteManager,
    roleManager,
    skillManager,
    cronService,
    chatStore,
  });
}
