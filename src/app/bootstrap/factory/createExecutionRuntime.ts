import { join } from 'path';
import {
  AgentRuntime,
  OutboundGateway,
  createConfiguredAgentRuntime
} from '../../../agent/index.js';
import { AgentRoleService } from '../../../agent/infrastructure/roles/AgentRoleService.js';
import { CommandRegistry } from '../../../agent/application/index.js';
import { SessionMemoryService } from '../../../agent/infrastructure/memory/SessionMemoryService.js';
import { SessionRoutingService } from '../../../agent/infrastructure/session/SessionRoutingService.js';
import {
  ConfigManager,
  getMainAgentConfig,
  getToolRuntimeConfig,
  resolveExecutionModel,
  resolveProviderSelection
} from '../../../features/config/index.js';
import { logger } from '../../../platform/observability/index.js';
import { createProvider } from '../../../platform/providers/index.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import { SessionManager } from '../../../features/sessions/index.js';
import { SkillManager } from '../../../features/skills/index.js';
import { ToolRegistry } from '../../../platform/tools/index.js';
import type { Config, VisionSettings } from '../../../types.js';
import { EventBus } from '../../../platform/events/EventBus.js';
import type { AesyClawEvents } from '../../../platform/events/events.js';
import { PluginManager } from '../../../features/plugins/index.js';

const appLog = logger.child('AesyClaw');

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

function createVisionProvider(config: Config, visionSettings: VisionSettings): LLMProvider | undefined {
  if (visionSettings.enabled === false) {
    return undefined;
  }

  if (!visionSettings.fallbackProviderName) {
    return undefined;
  }
  if (!visionSettings.fallbackModelName) {
    return undefined;
  }

  const providerConfig = config.providers[visionSettings.fallbackProviderName];
  if (!providerConfig) {
    appLog.warn('未找到视觉回退提供商', { provider: visionSettings.fallbackProviderName });
    return undefined;
  }

  return createProvider(visionSettings.fallbackProviderName, providerConfig);
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
  appLog.info('技能加载完成', { skillCount: skillManager.listSkills().length });
  return skillManager;
}

export async function createExecutionRuntime(args: {
  getConfig: () => Config;
  setConfig: (config: Config) => void;
  updateConfig: (mutator: Parameters<ConfigManager['update']>[0]) => Promise<Config>;
  eventBus: EventBus<AesyClawEvents>;
  outboundGateway: OutboundGateway;
  workspace: string;
  sessionManager: SessionManager;
  sessionRouting: SessionRoutingService;
  memoryService?: SessionMemoryService;
}): Promise<{
  provider?: LLMProvider;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  skillManager: SkillManager;
  agentRoleService: AgentRoleService;
  agentRuntime: AgentRuntime;
  visionSettings: VisionSettings;
  visionProvider?: LLMProvider;
  setPluginManager: (pluginManager: PluginManager) => void;
}> {
  const { getConfig, setConfig, updateConfig, eventBus, outboundGateway, workspace, sessionManager, sessionRouting, memoryService } = args;
  const config = getConfig();
  const toolConfig = getToolRuntimeConfig(config);
  const mainAgentConfig = getMainAgentConfig(config);
  const toolRegistry = new ToolRegistry({
    defaultTimeout: toolConfig.timeoutMs
  });
  const commandRegistry = new CommandRegistry();
  const provider = mainAgentConfig.role.model.trim()
    ? createRequiredProvider(config, undefined, mainAgentConfig.role.model)
    : undefined;
  const visionSettings = mainAgentConfig.visionSettings;
  const visionProvider = createVisionProvider(config, visionSettings);
  const skillManager = await createSkillManager(config, workspace, updateConfig);
  const agentRoleService = new AgentRoleService(
    getConfig,
    setConfig,
    updateConfig,
    toolRegistry,
    skillManager
  );

  let pluginManagerRef: PluginManager | undefined;
  const agentRuntime = await createConfiguredAgentRuntime({
    provider,
    toolRegistry,
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
    getPluginManager: () => pluginManagerRef,
    eventBus
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
    setPluginManager(pluginManager: PluginManager) {
      pluginManagerRef = pluginManager;
    }
  };
}
