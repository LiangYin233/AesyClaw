import { z } from 'zod';

export const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default('0.0.0.0'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  adminToken: z.string().default('admin123'),
  corsOrigin: z.string().optional(),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export const ModelConfigSchema = z.object({
  modelname: z.string().describe('底层 API 真实识别的模型字符串'),
  maxToken: z.number().int().positive().describe('该模型允许的最大输出长度'),
  reasoning: z.boolean().default(false).describe('标识该模型是否具备原生思维链能力'),
  vision: z.boolean().default(false).describe('标识该模型是否为多模态，能否处理图片输入'),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const CustomProviderSchema = z.object({
  type: z.enum(['openai_chat', 'openai_completion', 'anthropic']).describe('Provider 类型'),
  api_key: z.string().optional().describe('API Key'),
  base_url: z.string().url().optional().describe('API Base URL'),
  models: z.record(z.string(), ModelConfigSchema).describe('模型能力预设字典'),
});

export type CustomProvider = z.infer<typeof CustomProviderSchema>;

export const ProvidersConfigSchema = z.record(z.string(), CustomProviderSchema);

export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

export const OneBotConfigSchema = z.object({
  enabled: z.boolean().default(false),
  ws_url: z.string().url().optional(),
  access_token: z.string().optional(),
  universal: CustomProviderSchema.optional(),
});

export const DiscordConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().optional(),
  bot_token: z.string().optional(),
  application_id: z.string().optional(),
});

export const ChannelsConfigSchema = z.object({
  onebot: OneBotConfigSchema.optional(),
  discord: DiscordConfigSchema.optional(),
  custom_ws: z.object({
    enabled: z.boolean().default(false),
    port: z.number().int().min(1).max(65535).default(8080),
    path: z.string().default('/ws'),
  }).optional(),
});

export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>;

export const MCPServerConfigSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

export const MCPConfigSchema = z.object({
  servers: z.array(MCPServerConfigSchema).default([]),
});

export type MCPConfig = z.infer<typeof MCPConfigSchema>;

export const PluginConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  options: z.record(z.string(), z.unknown()).optional(),
});

export type PluginConfig = z.infer<typeof PluginConfigSchema>;

export const PluginsConfigSchema = z.object({
  plugins: z.array(PluginConfigSchema).default([]),
});

export type PluginsConfig = z.infer<typeof PluginsConfigSchema>;

export const AgentConfigSchema = z.object({
  max_turns: z.number().int().nonnegative().default(50),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const MemoryConfigSchema = z.object({
  max_context_tokens: z.number().int().positive().default(128000),
  compression_threshold: z.number().int().positive().default(80000),
  danger_threshold: z.number().int().positive().default(30000),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

export const FullConfigSchema = z.object({
  server: ServerConfigSchema,
  providers: ProvidersConfigSchema,
  channels: ChannelsConfigSchema.optional(),
  agent: AgentConfigSchema,
  memory: MemoryConfigSchema,
  mcp: MCPConfigSchema.optional(),
  plugins: PluginsConfigSchema.optional(),
});

export type FullConfig = z.infer<typeof FullConfigSchema>;

export const DEFAULT_CONFIG: FullConfig = {
  server: {
    port: 3000,
    host: '0.0.0.0',
    logLevel: 'info',
    adminToken: 'admin123',
  },
  providers: {},
  agent: {
    max_turns: 50,
  },
  memory: {
    max_context_tokens: 128000,
    compression_threshold: 80000,
    danger_threshold: 30000,
  },
};
