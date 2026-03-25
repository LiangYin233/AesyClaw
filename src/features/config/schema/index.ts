import { z } from 'zod';
import { isEmbeddingCapableProvider } from '../providerCapabilities.js';
import { parseModelRef } from '../modelRef.js';
import { resolveConfig, type ResolvedConfig } from '../resolve.js';
import {
  agentConfigSchema,
  agentRoleConfigSchema,
  agentsConfigSchema,
  contextModeSchema,
  createDefaultMainAgentRole,
  type AgentConfig,
  type AgentRoleConfig,
  type AgentsConfig
} from './agent.js';
import {
  memoryFactsConfigSchema,
  memorySummaryConfigSchema,
  type MemoryFactsConfig,
  type MemorySummaryConfig
} from './memory.js';
import {
  createDefaultProviders,
  providerConfigSchema,
  providerTypeSchema,
  type ProviderConfig,
  type ProviderModelConfig
} from './providers.js';
import { serverConfigSchema, type ServerConfig } from './server.js';
import { HTTP_URL_PROTOCOL, withObjectInputDefault } from './shared.js';
import {
  observabilityConfigSchema,
  toolsConfigSchema,
  type LoggingConfig,
  type ObservabilityConfig,
  type ToolsConfig
} from './tools.js';

const channelConfigSchema = z.record(z.string(), z.unknown());

const pluginConfigSchema = z.object({
  enabled: z.boolean().optional(),
  options: z.record(z.string(), z.unknown()).optional()
}).catchall(z.unknown());

const skillConfigSchema = z.object({
  enabled: z.boolean().default(true)
});

const mcpTransportTypeSchema = z.enum(['local', 'http']);

const mcpServerConfigSchema = withObjectInputDefault({
  type: mcpTransportTypeSchema.default('local'),
  command: z.array(z.string()).optional(),
  url: z.url({ protocol: HTTP_URL_PROTOCOL }).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true),
  timeout: z.number().int().finite().optional(),
  headers: z.record(z.string(), z.string()).optional()
}).superRefine((value, ctx) => {
  if (value.type === 'local' && (!value.command || value.command.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['command'],
      message: 'local MCP server requires command'
    });
  }

  if (value.type === 'http' && !value.url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['url'],
      message: 'http MCP server requires url'
    });
  }
});

const mcpServersConfigSchema = z.record(z.string(), mcpServerConfigSchema).default(() => ({}));

const baseConfigSchema = z.object({
  server: serverConfigSchema,
  agent: agentConfigSchema,
  agents: agentsConfigSchema,
  channels: z.record(z.string(), channelConfigSchema).default(() => ({})),
  providers: z.record(z.string(), providerConfigSchema).default(createDefaultProviders),
  mcp: mcpServersConfigSchema,
  plugins: z.record(z.string(), pluginConfigSchema).default(() => ({})),
  skills: z.record(z.string(), skillConfigSchema).default(() => ({})),
  observability: observabilityConfigSchema,
  tools: toolsConfigSchema
}).superRefine((value, ctx) => {
  const validateModelReference = (fieldPath: Array<string | number>, rawRef?: string, options?: { embeddingOnly?: boolean }) => {
    const trimmed = rawRef?.trim() || '';
    if (!trimmed) {
      return;
    }

    let parsed;
    try {
      parsed = parseModelRef(trimmed, fieldPath.join('.'));
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: fieldPath,
        message: error instanceof Error ? error.message : 'Invalid model reference'
      });
      return;
    }

    const providerConfig = value.providers[parsed.providerName];
    if (!providerConfig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: fieldPath,
        message: `provider not found for model reference: ${parsed.providerName}`
      });
      return;
    }

    if (!providerConfig.models?.[parsed.modelName]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: fieldPath,
        message: `model definition not found: ${parsed.providerName}/${parsed.modelName}`
      });
      return;
    }

    if (options?.embeddingOnly && !isEmbeddingCapableProvider(providerConfig)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: fieldPath,
        message: `${fieldPath.join('.')} must reference a provider with type "openai"`
      });
    }
  };

  for (const [roleName, role] of Object.entries(value.agents.roles)) {
    validateModelReference(['agents', 'roles', roleName, 'model'], role.model);
  }

  validateModelReference(['agent', 'defaults', 'memorySummary', 'model'], value.agent.defaults.memorySummary.model);
  validateModelReference(['agent', 'defaults', 'memoryFacts', 'model'], value.agent.defaults.memoryFacts.model);
  validateModelReference(
    ['agent', 'defaults', 'memoryFacts', 'retrievalModel'],
    value.agent.defaults.memoryFacts.retrievalModel,
    { embeddingOnly: true }
  );
  validateModelReference(['agent', 'defaults', 'visionFallbackModel'], value.agent.defaults.visionFallbackModel);
});

export type RawConfig = z.input<typeof baseConfigSchema>;
export type ParsedConfig = z.output<typeof baseConfigSchema>;
export type ContextMode = z.output<typeof contextModeSchema>;
export type ChannelConfig = z.output<typeof channelConfigSchema>;
export type PluginConfig = z.output<typeof pluginConfigSchema>;
export type SkillConfig = z.output<typeof skillConfigSchema>;
export type MCPTransportType = z.output<typeof mcpTransportTypeSchema>;
export type MCPServerConfig = z.output<typeof mcpServerConfigSchema>;
export type MCPServersConfig = z.output<typeof mcpServersConfigSchema>;
export type ProviderSelectionInput = Pick<ResolvedConfig, 'providers'>;
export type ResolvedProviderSelection = {
  name: string;
  model: string;
  providerConfig?: ProviderConfig;
  modelConfig?: ProviderModelConfig;
};
export type ConfigValidationIssue = {
  message: string;
  field?: string;
};

export const configSchema = baseConfigSchema.transform(resolveConfig);

export type Config = z.output<typeof configSchema>;

export function parseConfig(config: unknown): Config {
  return configSchema.parse(config);
}

export function parseMCPServerConfig(config: unknown): MCPServerConfig {
  return mcpServerConfigSchema.parse(config);
}

export function createDefaultConfig(): Config {
  return parseConfig({});
}

export function getConfigValidationIssue(error: unknown): ConfigValidationIssue | null {
  if (!(error instanceof z.ZodError)) {
    return null;
  }

  const issue = error.issues[0];
  if (!issue) {
    return { message: 'Invalid configuration' };
  }

  const field = issue.path.map(String).join('.');
  return {
    message: issue.message || 'Invalid configuration',
    field: field || undefined
  };
}

export const DEFAULT_CONFIG: Config = createDefaultConfig();

export {
  createDefaultMainAgentRole,
  memorySummaryConfigSchema,
  memoryFactsConfigSchema,
  providerTypeSchema,
  providerConfigSchema,
  agentRoleConfigSchema
};

export type { ResolvedConfig };
export type {
  AgentConfig,
  AgentRoleConfig,
  AgentsConfig,
  LoggingConfig,
  MemoryFactsConfig,
  MemorySummaryConfig,
  ObservabilityConfig,
  ProviderConfig,
  ServerConfig,
  ToolsConfig
};
