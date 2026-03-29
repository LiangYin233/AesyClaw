import { join } from 'path';
import { SkillManager } from '../../features/skills/index.js';
import type { Config } from '../../types.js';
import { Database } from '../../platform/db/index.js';
import { ToolRegistry } from '../../platform/tools/ToolRegistry.js';
import { LongTermMemoryStore, type MemoryOperationActor, type MemoryOperationInput } from '../../features/memory/infrastructure/LongTermMemoryStore.js';
import { McpClientManager } from '../../features/mcp/index.js';
import { syncMcpServerTools } from '../../features/mcp/index.js';
import { PluginManager } from '../../features/plugins/index.js';
import { normalizePluginConfigs } from '../../features/plugins/domain/config.js';
import { logger } from '../../platform/observability/index.js';
import { registerMemoryTools } from '../../platform/tools/builtins/registerMemoryTools.js';
import { registerSkillTools } from '../../platform/tools/builtins/registerSkillTools.js';
import { filePaths, dirPaths } from '../../platform/utils/paths.js';

export interface WorkerLocalToolRuntime {
  toolRegistry: ToolRegistry;
  skillManager: SkillManager;
  pluginManager?: PluginManager;
}

export async function createWorkerLocalToolRegistry(
  config: Config,
  workspace?: string
): Promise<WorkerLocalToolRuntime> {
  const toolRegistry = new ToolRegistry({
    defaultTimeout: typeof config.tools?.timeoutMs === 'number' ? config.tools.timeoutMs : undefined
  });
  const resolvedWorkspace = workspace?.trim() || process.cwd();
  const skillManager = new SkillManager({
    builtinSkillsDir: './skills',
    externalSkillsDir: join(resolvedWorkspace, 'skills')
  });

  skillManager.setConfig(config);
  await skillManager.loadFromDirectory();

  registerSkillTools({
    toolRegistry,
    skillManager: skillManager as any
  });

  const memoryDatabase = new Database(filePaths.sessionsDb());
  await memoryDatabase.ready();
  const longTermMemoryStore = new LongTermMemoryStore(memoryDatabase);

  registerMemoryTools({
    toolRegistry,
    memoryService: {
      hasLongTermMemory: () => true,
      listLongTermMemory: async (channel: string, chatId: string) =>
        longTermMemoryStore.listEntries(channel, chatId, { statuses: ['active', 'archived'] }),
      listLongTermMemoryOperations: async (channel: string, chatId: string, limit = 10) =>
        longTermMemoryStore.listOperations(channel, chatId, limit),
      applyLongTermMemoryOperations: async (
        channel: string,
        chatId: string,
        operations: MemoryOperationInput[],
        actor: MemoryOperationActor
      ) => Promise.all(
        operations.map((operation: MemoryOperationInput) =>
          longTermMemoryStore.applyOperation(channel, chatId, operation, actor)
        )
      )
    } as never
  });

  const enabledMcpServers = Object.entries(config.mcp || {}).filter(([, server]) => server.enabled !== false);
  if (enabledMcpServers.length > 0) {
    const mcpManager = new McpClientManager();

    for (const [serverName, serverConfig] of enabledMcpServers) {
      try {
        await mcpManager.connectOne(serverName, serverConfig);
        syncMcpServerTools(toolRegistry, mcpManager, serverName);
      } catch {
        // worker 内初始化 MCP 失败时，后续改走父进程桥接路径。
      }
    }
  }

  const pluginConfigs = normalizePluginConfigs(
    (config.plugins || {}) as Record<string, { enabled?: boolean; options?: Record<string, unknown> }>
  );
  let pluginManager: PluginManager | undefined;
  if (Object.keys(pluginConfigs).length > 0) {
    pluginManager = new PluginManager({
      getConfig: () => config,
      workspace: resolvedWorkspace,
      tempDir: dirPaths.temp(),
      toolRegistry,
      publishOutbound: async () => {},
      logger
    });

    pluginManager.setPluginConfigs(pluginConfigs);
    await pluginManager.loadFromConfig(pluginConfigs);
  }

  return {
    toolRegistry,
    skillManager,
    pluginManager
  };
}
