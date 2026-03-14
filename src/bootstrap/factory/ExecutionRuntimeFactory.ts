import type { Config, VisionSettings } from '../../types.js';
import { AgentRuntime, OutboundGateway } from '../../agent/runtime/AgentRuntime.js';
import { createProvider } from '../../providers/index.js';
import { ToolRegistry } from '../../tools/index.js';
import { CommandRegistry } from '../../agent/commands/index.js';
import type { PluginManager } from '../../plugins/index.js';
import type { SessionMemoryService } from '../../agent/memory/SessionMemoryService.js';
import type { SessionRoutingService } from '../../agent/session/SessionRoutingService.js';
import type { SessionManager } from '../../session/index.js';
import { SkillManager } from '../../skills/index.js';
import { AgentRoleService } from '../../agent/roles/AgentRoleService.js';
import { getMainAgentRole, resolveProviderSelection } from '../../config/index.js';
import { logger } from '../../observability/index.js';

const log = logger.child('ExecutionRuntimeFactory');

function createRequiredProvider(config: Config, providerName?: string, modelName?: string) {
  const resolved = resolveProviderSelection(config, providerName, modelName);
  if (!resolved.providerConfig) {
    throw new Error(`Provider "${resolved.name}" not found in config`);
  }

  return createProvider(resolved.name, resolved.providerConfig);
}

function createVisionProvider(config: Config, visionSettings: VisionSettings) {
  if (visionSettings.enabled === false) {
    return undefined;
  }

  if (!visionSettings.visionProviderName) {
    log.warn('Vision provider missing', { provider: '', model: visionSettings.visionModelName });
    return undefined;
  }
  if (!visionSettings.visionModelName) {
    log.warn('Vision model missing', { provider: visionSettings.visionProviderName });
    return undefined;
  }

  const providerConfig = config.providers[visionSettings.visionProviderName];
  if (!providerConfig) {
    log.warn('Vision provider missing', { provider: visionSettings.visionProviderName });
    return undefined;
  }

  return createProvider(visionSettings.visionProviderName, providerConfig);
}

function buildVisionSettingsFromRole(config: ReturnType<typeof getMainAgentRole>): VisionSettings {
  return {
    enabled: config.vision,
    reasoning: config.reasoning,
    visionProviderName: config.visionProvider || undefined,
    visionModelName: config.visionModel || undefined
  };
}

async function createSkillManager(config: Config): Promise<SkillManager> {
  const skillManager = new SkillManager('./skills');
  skillManager.setConfig(config);
  await skillManager.loadFromDirectory();
  await skillManager.startWatching();
  log.info('Skills loaded', { skillCount: skillManager.listSkills().length });
  return skillManager;
}

export async function createExecutionRuntime(args: {
  getConfig: () => Config;
  setConfig: (config: Config) => void;
  outboundGateway: OutboundGateway;
  workspace: string;
  sessionManager: SessionManager;
  sessionRouting: SessionRoutingService;
  memoryService?: SessionMemoryService;
}): Promise<{
  provider: ReturnType<typeof createRequiredProvider>;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  skillManager: SkillManager;
  agentRoleService: AgentRoleService;
  agentRuntime: AgentRuntime;
  visionSettings: VisionSettings;
  visionProvider?: ReturnType<typeof createVisionProvider>;
  setPluginManager: (pluginManager: PluginManager) => void;
}> {
  const { getConfig, setConfig, outboundGateway, workspace, sessionManager, sessionRouting, memoryService } = args;
  const config = getConfig();
  const toolRegistry = new ToolRegistry({
    defaultTimeout: config.tools.timeoutMs
  });
  const commandRegistry = new CommandRegistry();
  const mainRole = getMainAgentRole(config);
  const provider = createRequiredProvider(config, mainRole.provider, mainRole.model);
  const visionSettings = buildVisionSettingsFromRole(mainRole);
  const visionProvider = createVisionProvider(config, visionSettings);
  const skillManager = await createSkillManager(config);
  const agentRoleService = new AgentRoleService(
    getConfig,
    setConfig,
    toolRegistry,
    skillManager
  );

  let pluginManagerRef: PluginManager | undefined;
  const agentRuntime = new AgentRuntime({
    provider,
    toolRegistry,
    sessionManager,
    commandRegistry,
    sessionRouting,
    outboundGateway,
    workspace,
    systemPrompt: mainRole.systemPrompt,
    maxIterations: config.agent.defaults.maxToolIterations,
    model: mainRole.model,
    contextMode: config.agent.defaults.contextMode,
    memoryWindow: config.agent.defaults.memoryWindow,
    visionSettings,
    visionProvider,
    memoryService,
    agentRoleService,
    getPluginManager: () => pluginManagerRef
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
