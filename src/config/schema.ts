import { z } from 'zod';

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful AI assistant.';
const DEFAULT_PROVIDER_NAME = 'openai';
const DEFAULT_PROVIDER_MODEL = 'gpt-4o';
const DEFAULT_PROVIDER_API_BASE = 'https://api.openai.com/v1';
const HTTP_URL_PROTOCOL = /^https?$/;
const MAIN_AGENT_NAME = 'main';

function withObjectInputDefault<T extends z.ZodRawShape>(shape: T) {
  const schema = z.object(shape);
  return schema.prefault(() => ({} as z.input<typeof schema>));
}

const memorySummaryConfigSchema = withObjectInputDefault({
  enabled: z.boolean().default(false),
  provider: z.string().default(''),
  model: z.string().default(''),
  triggerMessages: z.number().int().finite().default(50)
});

const memoryFactsConfigSchema = withObjectInputDefault({
  enabled: z.boolean().default(false),
  provider: z.string().default(''),
  model: z.string().default(''),
  maxFacts: z.number().int().finite().default(100)
});

const providerApiBaseSchema = z.union([
  z.literal(''),
  z.url({ protocol: HTTP_URL_PROTOCOL })
]);

const providerConfigSchema = z.object({
  apiKey: z.string().optional(),
  apiBase: providerApiBaseSchema.optional(),
  model: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  extraBody: z.record(z.string(), z.unknown()).optional()
});

const agentRoleConfigSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  systemPrompt: z.string().default(DEFAULT_SYSTEM_PROMPT),
  provider: z.string().default(DEFAULT_PROVIDER_NAME),
  model: z.string().default(DEFAULT_PROVIDER_MODEL),
  vision: z.boolean().default(false),
  reasoning: z.boolean().default(false),
  visionProvider: z.string().default(''),
  visionModel: z.string().default(''),
  maxToolIterations: z.number().int().finite().default(40),
  allowedSkills: z.array(z.string()).default(() => []),
  allowedTools: z.array(z.string()).default(() => [])
});

const agentDefaultsSchema = z.object({
  memoryWindow: z.number().int().finite().default(50),
  memorySummary: memorySummaryConfigSchema,
  memoryFacts: memoryFactsConfigSchema,
  contextMode: z.enum(['session', 'channel', 'global']).default('channel'),
  maxSessions: z.number().int().finite().default(100)
}).strict().prefault(() => ({}));

const agentConfigSchema = withObjectInputDefault({
  defaults: agentDefaultsSchema
});

function createDefaultMainAgentRole(): z.output<typeof agentRoleConfigSchema> {
  return agentRoleConfigSchema.parse({
    name: MAIN_AGENT_NAME,
    description: '内建主 Agent',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    provider: DEFAULT_PROVIDER_NAME,
    model: DEFAULT_PROVIDER_MODEL,
    vision: false,
    reasoning: false,
    visionProvider: '',
    visionModel: '',
    maxToolIterations: 40,
    allowedSkills: [],
    allowedTools: []
  });
}

const agentsConfigSchema = z.object({
  roles: z.record(z.string(), agentRoleConfigSchema)
    .default(() => ({
      [MAIN_AGENT_NAME]: createDefaultMainAgentRole()
    }))
}).strict().prefault(() => ({
  roles: {
    [MAIN_AGENT_NAME]: createDefaultMainAgentRole()
  }
})).superRefine((value, ctx) => {
  if (!value.roles[MAIN_AGENT_NAME]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['roles', MAIN_AGENT_NAME],
      message: 'agents.roles.main is required'
    });
  }
});

const toolsConfigSchema = withObjectInputDefault({
  timeoutMs: z.number().int().finite().default(30000)
});

const loggingConfigSchema = withObjectInputDefault({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  bufferSize: z.number().int().finite().default(1000)
});

const usageConfigSchema = withObjectInputDefault({
  enabled: z.boolean().default(true),
  persistFile: z.string().default('.aesyclaw/token-usage.json'),
  flushIntervalMs: z.number().int().finite().default(30000)
});

const observabilityConfigSchema = withObjectInputDefault({
  logging: loggingConfigSchema,
  usage: usageConfigSchema
});

const serverConfigSchema = withObjectInputDefault({
  host: z.string().default('0.0.0.0'),
  apiPort: z.number().int().finite().default(18792),
  apiEnabled: z.boolean().default(true),
  token: z.string().default('')
});

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
});

type ParsedConfig = z.output<typeof baseConfigSchema>;

export type MemorySummaryConfig = z.output<typeof memorySummaryConfigSchema>;
export type MemoryFactsConfig = z.output<typeof memoryFactsConfigSchema>;
export type ProviderConfig = z.output<typeof providerConfigSchema>;
export type AgentRoleConfig = z.output<typeof agentRoleConfigSchema>;
export type AgentConfig = z.output<typeof agentConfigSchema>;
export type AgentsConfig = z.output<typeof agentsConfigSchema>;
export type ToolsConfig = z.output<typeof toolsConfigSchema>;
export type LoggingConfig = z.output<typeof loggingConfigSchema>;
export type UsageConfig = z.output<typeof usageConfigSchema>;
export type ObservabilityConfig = z.output<typeof observabilityConfigSchema>;
export type ServerConfig = z.output<typeof serverConfigSchema>;
export type ChannelConfig = z.output<typeof channelConfigSchema>;
export type PluginConfig = z.output<typeof pluginConfigSchema>;
export type SkillConfig = z.output<typeof skillConfigSchema>;
export type MCPTransportType = z.output<typeof mcpTransportTypeSchema>;
export type MCPServerConfig = z.output<typeof mcpServerConfigSchema>;
export type MCPServersConfig = z.output<typeof mcpServersConfigSchema>;
export type ConfigValidationIssue = {
  message: string;
  field?: string;
};
export type ResolvedProviderSelection = {
  name: string;
  model: string;
  providerConfig?: ProviderConfig;
};

function createDefaultProviders(): Record<string, ProviderConfig> {
  return {
    [DEFAULT_PROVIDER_NAME]: {
      apiKey: '',
      apiBase: DEFAULT_PROVIDER_API_BASE,
      model: DEFAULT_PROVIDER_MODEL
    }
  };
}

function ensureProviders(providers: Record<string, ProviderConfig>): Record<string, ProviderConfig> {
  return Object.keys(providers).length > 0 ? providers : createDefaultProviders();
}

function resolvePrimaryProviderName(providers: Record<string, ProviderConfig>, requestedName: string): string {
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

function normalizeParsedConfig(config: ParsedConfig) {
  const providers = ensureProviders(config.providers);
  const roles = Object.fromEntries(
    Object.entries(config.agents.roles).map(([name, role]) => [
      name,
      normalizeRole(name, role, providers)
    ])
  );

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

export const configSchema = baseConfigSchema.transform(normalizeParsedConfig);

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

export function resolveProviderSelection(
  config: Pick<Config, 'providers'>,
  providerName?: string,
  modelName?: string
): ResolvedProviderSelection {
  const name = resolvePrimaryProviderName(config.providers, providerName || DEFAULT_PROVIDER_NAME);
  const providerConfig = config.providers[name];

  return {
    name,
    model: modelName || providerConfig?.model || DEFAULT_PROVIDER_MODEL,
    providerConfig
  };
}

export function getMainAgentRole(config: Config): AgentRoleConfig {
  return config.agents.roles[MAIN_AGENT_NAME];
}

export function getConfigValidationIssue(error: unknown): ConfigValidationIssue | null {
  if (!(error instanceof z.ZodError)) {
    return null;
  }

  const issue = error.issues[0];
  if (!issue) {
    return { message: 'Invalid configuration' };
  }

  if (issue.code === 'unrecognized_keys' && issue.path.join('.') === 'agents' && issue.keys.includes('main')) {
    return {
      message: 'agents.main has been removed; use agents.roles.main',
      field: 'agents.main'
    };
  }

  if (issue.code === 'unrecognized_keys' && issue.path.join('.') === 'agent.defaults') {
    const migratedKey = issue.keys.find((key) => [
      'provider',
      'model',
      'description',
      'systemPrompt',
      'vision',
      'reasoning',
      'visionProvider',
      'visionModel',
      'maxToolIterations'
    ].includes(key));

    if (migratedKey) {
      return {
        message: `agent.defaults.${migratedKey} has been removed; move it to agents.roles.<name>.${migratedKey}`,
        field: `agent.defaults.${migratedKey}`
      };
    }
  }

  const field = issue.path.map(String).join('.');
  return {
    message: issue.message || 'Invalid configuration',
    field: field || undefined
  };
}

export const DEFAULT_CONFIG: Config = createDefaultConfig();
