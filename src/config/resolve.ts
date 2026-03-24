import { createDefaultMainAgentRole, type AgentRoleConfig } from './schema/agent.js';
import { parseModelRef } from './modelRef.js';
import { createDefaultProviders, getProviderModelConfig, type ProviderConfig } from './schema/providers.js';
import { DEFAULT_PROVIDER_NAME, MAIN_AGENT_NAME } from './schema/shared.js';
import type {
  ParsedConfig,
  ProviderSelectionInput,
  ResolvedProviderSelection
} from './schema/index.js';

export type ResolvedConfig = ParsedConfig;

function ensureProviders(providers: Record<string, ProviderConfig>): Record<string, ProviderConfig> {
  return Object.keys(providers).length > 0 ? providers : createDefaultProviders();
}

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
  const providers = ensureProviders(config.providers);
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
    providers,
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

  if (!name) {
    name = DEFAULT_PROVIDER_NAME;
  }

  const providerConfig = config.providers[name];

  return {
    name,
    model: resolvedModel,
    providerConfig,
    modelConfig: getProviderModelConfig(providerConfig, resolvedModel)
  };
}
