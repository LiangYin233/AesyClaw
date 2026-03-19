import { createDefaultMainAgentRole, type AgentRoleConfig } from './schema/agent.js';
import { createDefaultProviders, type ProviderConfig } from './schema/providers.js';
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

function resolvePrimaryProviderName(
  providers: Record<string, ProviderConfig>,
  requestedName: string
): string {
  if (providers[requestedName]) {
    return requestedName;
  }

  return Object.keys(providers)[0] ?? DEFAULT_PROVIDER_NAME;
}

function normalizeRole(
  name: string,
  role: AgentRoleConfig,
  providers: Record<string, ProviderConfig>
): AgentRoleConfig {
  return {
    ...role,
    name,
    provider: resolvePrimaryProviderName(providers, role.provider)
  };
}

export function resolveConfig(config: ParsedConfig): ResolvedConfig {
  const providers = ensureProviders(config.providers);
  const roles = Object.fromEntries(
    Object.entries(config.agents.roles).map(([name, role]) => [
      name,
      normalizeRole(name, role, providers)
    ])
  );

  if (!roles[MAIN_AGENT_NAME]) {
    roles[MAIN_AGENT_NAME] = normalizeRole(MAIN_AGENT_NAME, createDefaultMainAgentRole(), providers);
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
  providerName?: string,
  modelName?: string
): ResolvedProviderSelection {
  const name = resolvePrimaryProviderName(config.providers, providerName || DEFAULT_PROVIDER_NAME);
  const providerConfig = config.providers[name];

  return {
    name,
    model: modelName?.trim() || '',
    providerConfig
  };
}
