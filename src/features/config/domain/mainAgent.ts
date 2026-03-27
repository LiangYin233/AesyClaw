import type { VisionSettings } from '../../../types.js';
import { resolveProviderSelection } from '../resolve.js';
import { MAIN_AGENT_NAME } from '../schema/shared.js';
import type { AgentRoleConfig, ResolvedProviderSelection } from '../schema/index.js';
import { readConfig, type ConfigSource } from './shared.js';

export type ResolvedMainAgentConfig = {
  role: AgentRoleConfig;
  provider: ResolvedProviderSelection;
  maxIterations: number;
  memoryWindow: number;
  visionSettings: VisionSettings;
  visionProvider?: ResolvedProviderSelection;
};

export function getMainAgentRole(source: ConfigSource): AgentRoleConfig {
  const config = readConfig(source);
  return config.agents.roles[MAIN_AGENT_NAME];
}

export function getMainAgentConfig(source: ConfigSource): ResolvedMainAgentConfig {
  const config = readConfig(source);
  const role = getMainAgentRole(config);
  const provider = resolveProviderSelection(config, role.model);
  const directVision = provider.modelConfig?.supportsVision === true;
  const fallbackModelRef = config.agent.defaults.visionFallbackModel.trim() || undefined;
  const visionProvider = fallbackModelRef
    ? resolveProviderSelection(config, fallbackModelRef)
    : undefined;

  return {
    role,
    provider,
    maxIterations: config.agent.defaults.maxToolIterations,
    memoryWindow: config.agent.defaults.memoryWindow,
    visionSettings: {
      enabled: directVision || !!visionProvider,
      directVision,
      reasoning: visionProvider?.modelConfig?.reasoning === true,
      fallbackModelRef,
      fallbackProviderName: visionProvider?.name,
      fallbackModelName: visionProvider?.model
    },
    visionProvider
  };
}
