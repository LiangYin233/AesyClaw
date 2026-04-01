import { join } from 'path';
import {
  AgentRuntime,
  OutboundGateway,
  createConfiguredAgentRuntime
} from '../../../agent/index.js';
import { AgentRoleService } from '../../../features/agents/infrastructure/AgentRoleService.js';
import { CommandRegistry } from '../../../agent/application/index.js';
import { SessionMemoryService } from '../../../features/memory/infrastructure/SessionMemoryService.js';
import type { ISessionRouting } from '../../../agent/domain/session.js';
import {
  createVisionProviderFromSettings,
  ConfigManager,
  resolveExecutionModel,
  resolveProviderSelection
} from '../../../features/config/index.js';
import { getMainAgentConfig, getToolRuntimeConfig } from '../../../platform/context/index.js';
import { createProvider } from '../../../platform/providers/index.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import { SessionManager } from '../../../agent/infrastructure/session/SessionManager.js';
import { SkillManager } from '../../../features/skills/index.js';
import { ToolRegistry } from '../../../platform/tools/index.js';
import { DefinitionAugmentedToolRegistry } from '../../../platform/tools/DefinitionAugmentedToolRegistry.js';
import { getAgentToolDefinitions } from '../../../platform/tools/builtins/registerAgentTools.js';
import type { Config, VisionSettings } from '../../../types.js';
import type { PluginCoordinator } from '../../../features/extension/plugin/index.js';

function createRequiredProvider(config: Config, providerName?: string, modelName?: string): LLMProvider {
  const resolved = providerName && modelName
    ? resolveProviderSelection(config, providerName, modelName)
    : resolveProviderSelection(config, modelName || providerName);
  if (!resolved.model) {
    throw new Error(`Model is required for provider "${resolved.name}"`);
  }
  if (!resolved.providerConfig) {
    throw new Error(`Provider "${resolved.name}" not found in config`);
  }

  return createProvider(resolved.name, resolved.providerConfig);
}

async function createSkillManager(
  config: Config,
  workspace: string,
  updateConfig: (mutator: Parameters<ConfigManager['update']>[0]) => Promise<Config>
): Promise<SkillManager> {
  const skillManager = new SkillManager({
    builtinSkillsDir: './skills',
    externalSkillsDir: join(workspace, 'skills'),
    updateConfig
  });
  skillManager.setConfig(config);
  await skillManager.loadFromDirectory();
  await skillManager.startWatching();
  return skillManager;
}

export async function createExecutionRuntime(args: {
  getConfig: () => Config;
  updateConfig: (mutator: Parameters<ConfigManager['update']>[0]) => Promise<Config>;
  outboundGateway: OutboundGateway;
  workspace: string;
  sessionManager: SessionManager;
  sessionRouting: ISessionRouting;
  memoryService?: SessionMemoryService;
  pluginCoordinatorReady?: Promise<PluginCoordinator>;
}): Promise<{
  provider?: LLMProvider;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  skillManager: SkillManager;
  agentRoleService: AgentRoleService;
  agentRuntime: AgentRuntime;
  visionSettings: VisionSettings;
  visionProvider?: LLMProvider;
  setPluginManager: (pluginManager: PluginCoordinator) => void;
}> {
  const { getConfig, updateConfig, outboundGateway, workspace, sessionManager, sessionRouting, memoryService } = args;
  const config = getConfig();
  const toolConfig = getToolRuntimeConfig(config);
  const mainAgentConfig = getMainAgentConfig(config);
  const toolRegistry = new ToolRegistry({
    defaultTimeout: toolConfig.timeoutMs
  });
  const toolRegistryDefinitions = new DefinitionAugmentedToolRegistry(
    toolRegistry,
    getAgentToolDefinitions()
  );
  const commandRegistry = new CommandRegistry();
  const provider = mainAgentConfig.role.model.trim()
    ? createRequiredProvider(config, undefined, mainAgentConfig.role.model)
    : undefined;
  const visionSettings = mainAgentConfig.visionSettings;
  const visionProvider = createVisionProviderFromSettings(config, visionSettings);
  const skillManager = await createSkillManager(config, workspace, updateConfig);
  const agentRoleService = new AgentRoleService(
    getConfig,
    updateConfig,
    toolRegistryDefinitions,
    skillManager
  );

  let pluginManagerRef: PluginCoordinator | undefined;
  const getPluginManager = async (): Promise<PluginCoordinator | undefined> => {
    if (pluginManagerRef) {
      return pluginManagerRef;
    }
    if (args.pluginCoordinatorReady) {
      return args.pluginCoordinatorReady;
    }
    return undefined;
  };
  const agentRuntime = await createConfiguredAgentRuntime({
    getConfig,
    provider,
    toolRegistry,
    toolRegistryDefinitions,
    sessionManager,
    commandRegistry,
    sessionRouting,
    outboundGateway,
    workspace,
    systemPrompt: mainAgentConfig.role.systemPrompt,
    maxIterations: mainAgentConfig.maxIterations,
    model: resolveExecutionModel(mainAgentConfig.role.model),
    memoryWindow: mainAgentConfig.memoryWindow,
    visionSettings,
    visionProvider,
    memoryService,
    agentRoleService,
    getPluginManager,
  });

  return {
    provider,
    toolRegistry,
    commandRegistry,
    skillManager,
    agentRoleService,
    agentRuntime,
    visionSettings,
    visionProvider,
    setPluginManager(pluginManager: PluginCoordinator) {
      pluginManagerRef = pluginManager;
    }
  };
}
