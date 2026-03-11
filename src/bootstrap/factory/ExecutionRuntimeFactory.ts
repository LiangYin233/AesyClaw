import type { Config, VisionSettings } from '../../types.js';
import type { EventBus } from '../../bus/EventBus.js';
import { AgentLoop } from '../../agent/index.js';
import { createProvider, createProviderFromConfig } from '../../providers/index.js';
import { ToolRegistry } from '../../tools/index.js';
import type { SessionMemoryService } from '../../agent/memory/SessionMemoryService.js';
import type { SessionRoutingService } from '../../agent/session/SessionRoutingService.js';
import type { SessionManager } from '../../session/index.js';
import { SkillManager } from '../../skills/index.js';
import { AgentRoleService } from '../../agent/roles/AgentRoleService.js';
import { logger } from '../../logger/index.js';

const log = logger.child({ prefix: 'ExecutionRuntimeFactory' });

function resolveProviderConfig(config: Config, providerName?: string, modelName?: string) {
  const name = providerName || config.agent.defaults.provider;
  const providerConfig = config.providers[name];

  return {
    name,
    model: modelName || providerConfig?.model || config.agent.defaults.model,
    providerConfig
  };
}

function createRequiredProvider(config: Config, providerName?: string, modelName?: string) {
  const resolved = resolveProviderConfig(config, providerName, modelName);
  if (!resolved.providerConfig) {
    throw new Error(`Default provider "${resolved.name}" not found in config`);
  }

  return createProvider(resolved.name, resolved.providerConfig);
}

function createVisionProvider(config: Config, visionSettings: VisionSettings) {
  if (!visionSettings.visionProviderName) {
    return undefined;
  }

  const providerConfig = config.providers[visionSettings.visionProviderName];
  if (!providerConfig) {
    log.warn(`Vision provider "${visionSettings.visionProviderName}" not found in config`);
    return undefined;
  }

  return createProviderFromConfig(providerConfig);
}

async function createSkillManager(config: Config): Promise<SkillManager> {
  const skillManager = new SkillManager('./skills');
  skillManager.setConfig(config);
  await skillManager.loadFromDirectory();
  log.info(`SkillManager initialized with ${skillManager.listSkills().length} skills`);
  return skillManager;
}

export async function createExecutionRuntime(args: {
  getConfig: () => Config;
  setConfig: (config: Config) => void;
  eventBus: EventBus;
  workspace: string;
  sessionManager: SessionManager;
  sessionRouting: SessionRoutingService;
  memoryService?: SessionMemoryService;
}): Promise<{
  provider: ReturnType<typeof createRequiredProvider>;
  toolRegistry: ToolRegistry;
  skillManager: SkillManager;
  agentRoleService: AgentRoleService;
  agent: AgentLoop;
  visionSettings: VisionSettings;
  visionProvider?: ReturnType<typeof createVisionProvider>;
}> {
  const { getConfig, setConfig, eventBus, workspace, sessionManager, sessionRouting, memoryService } = args;
  const config = getConfig();
  const toolRegistry = new ToolRegistry({
    defaultTimeout: config.tools?.timeoutMs
  });
  const provider = createRequiredProvider(config);
  const agentDefaults = config.agent.defaults;
  const visionSettings: VisionSettings = {
    enabled: agentDefaults.vision || false,
    reasoning: agentDefaults.reasoning || false,
    visionProviderName: agentDefaults.visionProvider,
    visionModelName: agentDefaults.visionModel
  };
  const visionProvider = createVisionProvider(config, visionSettings);
  const skillManager = await createSkillManager(config);
  const agentRoleService = new AgentRoleService(
    getConfig,
    setConfig,
    toolRegistry,
    skillManager
  );

  const agent = new AgentLoop(
    eventBus,
    provider,
    toolRegistry,
    sessionManager,
    workspace,
    config.agent.defaults.systemPrompt,
    config.agent.defaults.maxToolIterations,
    config.agent.defaults.model,
    config.agent.defaults.contextMode,
    config.agent.defaults.memoryWindow,
    skillManager,
    visionSettings,
    visionProvider,
    sessionRouting,
    memoryService,
    agentRoleService
  );

  return {
    provider,
    toolRegistry,
    skillManager,
    agentRoleService,
    agent,
    visionSettings,
    visionProvider
  };
}
