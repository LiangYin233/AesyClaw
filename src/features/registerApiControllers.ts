import type { ApiFeatureControllerDeps } from './featureDeps.js';
import { registerAgentsFeature } from './agents/registerAgentsFeature.js';
import { registerChannelsFeature } from './channels/registerChannelsFeature.js';
import { registerChatFeature } from './chat/registerChatFeature.js';
import { registerConfigFeature } from './config/registerConfigFeature.js';
import { registerCronFeature } from './cron/registerCronFeature.js';
import { registerMcpFeature } from './mcp/registerMcpFeature.js';
import { registerMemoryFeature } from './memory/registerMemoryFeature.js';
import { registerObservabilityFeature } from './observability/registerObservabilityFeature.js';
import { registerPluginsFeature } from './plugins/registerPluginsFeature.js';
import { registerSessionsFeature } from './sessions/registerSessionsFeature.js';
import { registerSkillsFeature } from './skills/registerSkillsFeature.js';
import { registerSystemFeature } from './system/registerSystemFeature.js';

export function registerApiControllers(deps: ApiFeatureControllerDeps): void {
  registerSystemFeature(deps);
  registerSessionsFeature(deps);
  registerAgentsFeature(deps);
  registerChatFeature(deps);
  registerChannelsFeature(deps);
  registerConfigFeature(deps);
  registerMemoryFeature(deps);
  registerSkillsFeature(deps);
  registerPluginsFeature(deps);
  registerCronFeature(deps);
  registerMcpFeature(deps);
  registerObservabilityFeature(deps);
}
