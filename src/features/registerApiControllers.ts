import type { ApiFeatureControllerDeps } from './featureDeps.js';
import { registerAgentsFeature } from './agents/registerAgentsFeature.js';
import { registerChannelsFeature } from './channels/index.js';
import { registerChatFeature } from './chat/index.js';
import { registerConfigFeature } from './config/index.js';
import { registerCronFeature } from './cron/index.js';
import { registerMcpFeature } from './mcp/index.js';
import { registerMemoryFeature } from './memory/index.js';
import { registerObservabilityFeature } from './observability/index.js';
import { registerPluginsFeature } from './plugins/index.js';
import { registerSessionsFeature } from './sessions/index.js';
import { registerSkillsFeature } from './skills/registerSkillsFeature.js';
import { registerSystemFeature } from './system/index.js';

export function registerApiControllers(deps: ApiFeatureControllerDeps): void {
  registerSystemFeature(deps);
  registerSessionsFeature({
    app: deps.app,
    sessionManager: deps.sessionManager,
    sessionRouting: deps.sessionRouting,
    agentRoleService: deps.agentRoleService
  });
  registerAgentsFeature(deps);
  registerChatFeature({
    app: deps.app,
    maxMessageLength: deps.maxMessageLength,
    agentRuntime: deps.agentRuntime,
    log: deps.log
  });
  registerChannelsFeature({
    app: deps.app,
    channelManager: deps.channelManager,
    getConfig: deps.getConfig,
    maxMessageLength: deps.maxMessageLength,
    log: deps.log
  });
  registerConfigFeature({
    app: deps.app,
    log: deps.log
  });
  registerMemoryFeature(deps);
  registerSkillsFeature(deps);
  registerPluginsFeature({
    app: deps.app,
    pluginManager: deps.pluginManager,
    channelManager: deps.channelManager,
    getConfig: deps.getConfig,
    updateConfig: deps.updateConfig
  });
  registerCronFeature({
    app: deps.app,
    cronService: deps.cronService
  });
  registerMcpFeature({
    app: deps.app,
    toolRegistry: deps.toolRegistry,
    getConfig: deps.getConfig,
    updateConfig: deps.updateConfig,
    getMcpManager: deps.getMcpManager,
    setMcpManager: deps.setMcpManager
  });
  registerObservabilityFeature(deps);
}
