import * as fs from 'fs';
import * as path from 'path';
import { agentStage } from '@/agent/runtime/agent-message-stage.js';
import {
  createSessionStage,
  getRoleInfoForCommandContext,
  switchRoleForCommandContext,
} from '@/agent/session/session-runtime.js';
import { ChatService } from '@/agent/session/session-service.js';
import { ChannelPipeline } from '@/agent/pipeline.js';
import { createSubAgentTools } from '@/agent/subagent/subagent-tools.js';
import type { ChannelPlugin } from '@/channels/channel-plugin.js';
import { ChannelPluginManager } from '@/channels/channel-manager.js';
import type { CommandDefinition } from '@/contracts/commands.js';
import type { PluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import { createCommandMiddleware } from '@/features/commands/command-middleware.js';
import { CommandManager } from '@/features/commands/command-registry.js';
import { createHelpCommandGroup } from '@/features/commands/help-command-group.js';
import { createSessionCommandGroup } from '@/features/commands/session-command-group.js';
import { configStage } from '@/features/config/config-message-stage.js';
import { configManager } from '@/features/config/config-manager.js';
import { AgentCronExecutor } from '@/agent/runtime/cron-executor.js';
import { cronTools } from '@/features/cron/cron-tools.js';
import { createPluginCommandGroup } from '@/features/plugins/plugin-command-group.js';
import { PluginManager } from '@/features/plugins/plugin-manager.js';
import { roleManager } from '@/features/roles/role-manager.js';
import { createRoleCommandGroup } from '@/features/roles/role-command-group.js';
import { SystemPromptManager } from '@/features/roles/system-prompt-manager.js';
import { cronService } from '@/features/cron/cron-service.js';
import { chatStore } from '@/platform/db/repositories/session-repository.js';
import { sqliteManager } from '@/platform/db/sqlite-manager.js';
import { logger } from '@/platform/observability/logger.js';
import { createRegistrationOwner } from '@/platform/registration/types.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import { createMultimodalTools } from '@/platform/tools/multimodal-tools.js';
import { McpClientManager } from '@/platform/tools/mcp/mcp-client-manager.js';
import { ToolManager } from '@/platform/tools/registry.js';
import { pathToFileURL } from 'url';
import { assertPackageNameMatchesExportedName } from '@/platform/utils/package-manifest.js';
import { discoverPluginsByPrefix, type DiscoveredPlugin } from '@/platform/utils/plugin-discovery.js';
import { pathResolver } from '@/platform/utils/paths.js';

export interface BootstrapOptions {
  skipDb?: boolean;
  skipConfig?: boolean;
  skipPlugins?: boolean;
  skipMCP?: boolean;
  skipSkills?: boolean;
  skipCron?: boolean;
  skipRoles?: boolean;
  skipSubAgents?: boolean;
  skipChannels?: boolean;
}

let pipeline: ChannelPipeline | null = null;
let mcpManager: McpClientManager | null = null;
let initialized = false;
let configChangeUnsubscribe: (() => void) | null = null;
let mcpHotReloadEnabled = false;
let channelHotReloadEnabled = false;
const toolManager = new ToolManager();
const commandManager = new CommandManager();
const systemPromptManager = new SystemPromptManager(toolManager);
const chatService = new ChatService({
  systemPromptManager,
  toolCatalog: toolManager,
  hookRuntime: undefined as unknown as PluginHookRuntime,
});

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map(k => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`)
    .join(',');
  return `{${body}}`;
}

export const pluginManager = new PluginManager({
  commandManager,
  toolManager,
  configStore: configManager,
});

(chatService as unknown as { deps: { hookRuntime: PluginHookRuntime } }).deps.hookRuntime = pluginManager;

export const channelManager = new ChannelPluginManager(configManager);

export function getHookRuntime(): PluginHookRuntime {
  return pluginManager;
}

function buildSystemCommands(): CommandDefinition[] {
  return [
    ...createHelpCommandGroup(commandManager),
    ...createPluginCommandGroup({
      getPluginCommands: () => commandManager.getPluginCommands(),
      enablePlugin: (pluginName) => pluginManager.enablePlugin(pluginName),
      disablePlugin: (pluginName) => pluginManager.disablePlugin(pluginName),
    }),
    ...createSessionCommandGroup(chatService),
    ...createRoleCommandGroup({
      getSessionForCommand: (ctx) => ({
        switchRole: (roleId) => switchRoleForCommandContext(chatService, ctx, roleId),
        getRoleInfo: () => getRoleInfoForCommandContext(chatService, ctx),
      }),
      toolCatalog: toolManager,
    }),
  ];
}

function registerSystemCommands(): void {
  const systemScope = commandManager.createScope(createRegistrationOwner('system', 'bootstrap'));
  const systemCommands = buildSystemCommands();
  systemScope.registerMany(systemCommands);
  logger.info({ count: systemCommands.length }, '系统命令已注册');
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<void> {
  if (initialized) {
    logger.warn({}, 'Bootstrap already initialized, skipping...');
    return;
  }

  try {
    logger.info({}, 'AesyClaw starting...');
    await runInitStages(options);
    initialized = true;
    logger.info({}, 'AesyClaw started successfully');
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error({ error: errorMessage, stack: errorStack }, 'Bootstrap failed');
    throw error;
  }
}

async function runInitStages(options: BootstrapOptions): Promise<void> {
  let multimodalTools: ReturnType<typeof createMultimodalTools> | null = null;

  const stages: Array<{ name: string; skip?: boolean; run: () => void | Promise<void> }> = [
    { name: 'PathResolver', run: () => pathResolver.initialize() },
    { name: 'Config', skip: options.skipConfig, run: () => configManager.initialize() },
    { name: 'SQLite', skip: options.skipDb, run: () => { sqliteManager.initialize(); } },
    {
      name: 'Aesyiu core',
      run: () => {
        multimodalTools = createMultimodalTools(() => configManager.config);
        pipeline = new ChannelPipeline(pluginManager);
      },
    },
    {
      name: 'SkillManager',
      skip: options.skipSkills,
      run: async () => {
        const { skillManager } = await import('@/features/skills/skill-manager.js');
        await skillManager.initialize();
        logger.info(skillManager.getStats(), 'Skills system loaded');
      },
    },
    {
      name: 'RoleManager',
      skip: options.skipRoles,
      run: async () => {
        await roleManager.initialize();
        logger.info({ roleCount: roleManager.getAllRoles().length }, 'Role system loaded');
      },
    },
    {
      name: 'SubAgent tools',
      skip: options.skipSubAgents,
      run: () => {
        const subAgentTools = createSubAgentTools({ toolCatalog: toolManager, hookRuntime: pluginManager });
        const scope = toolManager.createScope(createRegistrationOwner('system', 'subagent-tools'));
        for (const tool of subAgentTools) scope.register(tool);
        logger.info({ toolCount: subAgentTools.length }, 'SubAgent tools registered');
      },
    },
    {
      name: 'Multimodal tools',
      run: () => {
        if (!multimodalTools) return;
        const scope = toolManager.createScope(createRegistrationOwner('system', 'multimodal-tools'));
        scope.register(multimodalTools.speechToTextTool);
        scope.register(multimodalTools.imageUnderstandingTool);
        scope.register(multimodalTools.sendMsgTool);
      },
    },
    {
      name: 'Cron tools',
      run: () => {
        const scope = toolManager.createScope(createRegistrationOwner('system', 'cron-tools'));
        for (const tool of cronTools) scope.register(tool);
        logger.info({ toolCount: cronTools.length }, 'Cron tools registered');
      },
    },
    {
      name: 'Pipeline stages',
      run: () => {
        pipeline?.use(configStage);
        registerSystemCommands();
        pipeline?.use(createCommandMiddleware(commandManager));
        pipeline?.use(createSessionStage(chatService));
        pipeline?.use(agentStage);
      },
    },
    {
      name: 'Plugins',
      skip: options.skipPlugins,
      run: async () => {
        await pluginManager.initialize();
        await pluginManager.scanAndLoad(configManager.config?.plugins || []);
        logger.info({ loadedPlugins: pluginManager.getPluginCount() }, 'Plugins system loaded');
      },
    },
    {
      name: 'Cron',
      skip: options.skipCron,
      run: async () => {
        cronService.setExecutor(new AgentCronExecutor({
          systemPromptManager,
          toolCatalog: toolManager,
          hookRuntime: pluginManager,
        }));
        cronService.start();
        logger.info({ schedulerRunning: cronService.isRunning() }, 'Cron system initialized');
      },
    },
    {
      name: 'MCP servers',
      skip: options.skipMCP,
      run: async () => {
        mcpManager = new McpClientManager(toolManager);
        const servers = configManager.config?.mcp?.servers;
        if (servers) await mcpManager.connectConfiguredServers(servers);
      },
    },
    {
      name: 'Channels',
      skip: options.skipChannels,
      run: () => loadChannelPlugins(configManager.config?.channels || {}),
    },
    {
      name: 'Finalize',
      run: async () => {
        await configManager.syncAllDefaultConfigs();
        if (!options.skipConfig) {
          registerConfigChangeListener({
            mcp: !options.skipMCP,
            channels: !options.skipChannels,
          });
        }
      },
    },
  ];

  const active = stages.filter(s => !s.skip);
  for (const [i, stage] of active.entries()) {
    logger.info({}, `[${i + 1}/${active.length}] ${stage.name}...`);
    await stage.run();
  }
}

async function loadChannelPlugins(channels: Record<string, unknown>): Promise<void> {
  if (!pipeline) {
    logger.error({}, 'Pipeline not initialized, cannot load channel plugins');
    return;
  }

  channelManager.setPipeline(pipeline);

  const pluginsDir = path.join(process.cwd(), 'plugins');
  for (const discovered of discoverPluginsByPrefix(pluginsDir, 'channel_')) {
    await loadChannelPluginEntry(discovered, channels);
  }

  logger.info({ loadedChannels: channelManager.getChannelCount() }, 'Channel system initialized');
}

async function loadChannelPluginEntry(
  discovered: DiscoveredPlugin,
  channels: Record<string, unknown>
): Promise<void> {
  const pluginName = discovered.dirName;
  try {
    const entryPath = resolveChannelEntry(discovered);
    if (!entryPath) {
      logger.warn({ pluginName }, 'Channel plugin entry point not found');
      return;
    }

    const { default: channelPlugin } = await import(pathToFileURL(entryPath).href) as {
      default: ChannelPlugin;
    };

    assertPackageNameMatchesExportedName(discovered.packageJson, channelPlugin.name, 'Channel plugin');

    const channelConfig = (channels[channelPlugin.name] as Record<string, unknown> | undefined) || {};
    await channelManager.registerChannel(channelPlugin, channelConfig);
    logger.info({ channelName: channelPlugin.name }, `${channelPlugin.name} channel plugin loaded`);
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error({ error: errorMessage, stack: errorStack, pluginName }, 'Failed to load channel plugin');
  }
}

function resolveChannelEntry(discovered: DiscoveredPlugin): string | undefined {
  const mainFile = discovered.packageJson.main || 'dist/index.js';
  const candidates = [
    path.join(discovered.dir, mainFile),
    path.join(discovered.dir, 'index.ts'),
    path.join(discovered.dir, 'src/index.ts'),
  ];

  return candidates.find(candidate => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
}

function registerConfigChangeListener(opts: { mcp: boolean; channels: boolean }): void {
  configChangeUnsubscribe?.();
  configChangeUnsubscribe = null;

  mcpHotReloadEnabled = opts.mcp;
  channelHotReloadEnabled = opts.channels;

  configChangeUnsubscribe = configManager.onConfigChange(async (nextConfig, previousConfig) => {
    const mcpChanged = hasSerializedConfigChanged(
      previousConfig.mcp?.servers || [],
      nextConfig.mcp?.servers || []
    );
    const channelsChanged = hasSerializedConfigChanged(
      previousConfig.channels || {},
      nextConfig.channels || {}
    );

    if (mcpChanged) await reloadMcpServers(nextConfig);
    if (channelsChanged) await reloadChannelPlugins(nextConfig);
  });
}

async function reloadMcpServers(nextConfig: typeof configManager.config): Promise<void> {
  if (!mcpHotReloadEnabled || !mcpManager) return;

  logger.info({}, 'MCP config changed, reconnecting MCP servers');
  await mcpManager.shutdown();
  await mcpManager.connectConfiguredServers(nextConfig.mcp?.servers || []);
}

async function reloadChannelPlugins(nextConfig: typeof configManager.config): Promise<void> {
  if (!channelHotReloadEnabled) return;

  logger.info({}, 'Channel config changed, reloading channel plugins');
  await channelManager.shutdown();
  await loadChannelPlugins(nextConfig.channels || {});

  const previous = channelHotReloadEnabled;
  channelHotReloadEnabled = false;
  try {
    await configManager.syncAllDefaultConfigs();
  } finally {
    channelHotReloadEnabled = previous;
  }
}

function hasSerializedConfigChanged(previousValue: unknown, nextValue: unknown): boolean {
  return canonicalStringify(previousValue) !== canonicalStringify(nextValue);
}

export async function shutdown(): Promise<void> {
  logger.info({}, 'Shutting down AesyClaw...');

  configChangeUnsubscribe?.();
  configChangeUnsubscribe = null;
  mcpHotReloadEnabled = false;
  channelHotReloadEnabled = false;

  const steps: Array<[string, () => void | Promise<void>]> = [
    ['Channel Manager', () => channelManager.shutdown()],
    ['Cron scheduler', () => cronService.stop()],
    ['MCP Manager', async () => { if (mcpManager) await mcpManager.shutdown(); }],
    ['Plugin Manager', () => pluginManager.shutdown()],
    ['SQLiteManager', () => sqliteManager.close()],
    ['SkillManager', async () => {
      const { skillManager } = await import('@/features/skills/skill-manager.js');
      await skillManager.shutdown();
    }],
    ['RoleManager', () => roleManager.shutdown()],
    ['ConfigManager', () => configManager.destroy()],
  ];

  for (const [i, [label, fn]] of steps.entries()) {
    try {
      await fn();
      logger.info({}, `[${i + 1}/${steps.length}] ${label} stopped`);
    } catch (error) {
      logger.error({ error }, `Error stopping ${label}`);
    }
  }

  mcpManager = null;
  initialized = false;

  logger.info({}, 'AesyClaw shutdown completed');
}

export function isInitialized(): boolean {
  return initialized;
}

export async function restart(options: BootstrapOptions = {}): Promise<void> {
  await shutdown();
  await bootstrap(options);
}

export function getStatus() {
  const mcpServers = mcpManager?.getConnectedServers() || [];
  return {
    initialized,
    pathResolver: pathResolver.isInitialized(),
    configManager: configManager.isInitialized(),
    sqliteManager: sqliteManager.isInitialized(),
    toolRegistry: { totalTools: toolManager.getStats().totalTools },
    roles: { total: roleManager.isInitialized() ? roleManager.getAllRoles().length : 0 },
    sessions: { total: sqliteManager.isInitialized() ? chatStore.count() : 0 },
    mcpServers: mcpServers.filter(s => s.connected).length,
    plugins: pluginManager.getLoadedPlugins().length,
    channels: channelManager.getChannelCount(),
    cron: {
      running: cronService.isRunning(),
      scheduledTasks: cronService.getScheduledTaskCount(),
    },
  };
}
