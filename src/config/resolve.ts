import { createDefaultMainAgentRole, type AgentRoleConfig } from './schema/agent.js';
import { parseModelRef } from './modelRef.js';
import { getProviderModelConfig, type ProviderConfig } from './schema/providers.js';
import { MAIN_AGENT_NAME } from './schema/shared.js';
import type {
  ParsedConfig,
  ProviderSelectionInput,
  ResolvedProviderSelection
} from './schema/index.js';

export type ResolvedConfig = ParsedConfig;

function normalizeRole(
  name: string,
  role: AgentRoleConfig
): AgentRoleConfig {
  return {
    ...role,
    name
  };
}

export function resolveConfig(config: ParsedConfig): ResolvedConfig {
  const roles = Object.fromEntries(
    Object.entries(config.agents.roles).map(([name, role]) => [
      name,
      normalizeRole(name, role)
    ])
  );

  if (!roles[MAIN_AGENT_NAME]) {
    roles[MAIN_AGENT_NAME] = normalizeRole(MAIN_AGENT_NAME, createDefaultMainAgentRole());
  }

  return {
    ...config,
    providers: config.providers,
    agent: {
      defaults: config.agent.defaults
    },
    agents: {
      roles
    }
  };
}

export function resolveProviderSelection(
  config: ProviderSelectionInput,
  providerNameOrModelRef?: string,
  modelName?: string
): ResolvedProviderSelection {
  let name = (providerNameOrModelRef || '').trim();
  let resolvedModel = modelName?.trim() || '';

  if (!resolvedModel && name.includes('/')) {
    const parsed = parseModelRef(name);
    name = parsed.providerName;
    resolvedModel = parsed.modelName;
  }

  const providerConfig = config.providers[name];

  return {
    name,
    model: resolvedModel,
    providerConfig,
    modelConfig: getProviderModelConfig(providerConfig, resolvedModel)
  };
}
