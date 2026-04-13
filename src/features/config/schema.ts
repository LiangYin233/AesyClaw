import { z } from 'zod';

export const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default('0.0.0.0'),
  log_level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  cors_origin: z.string().optional(),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export const ModelConfigSchema = z.object({
  modelname: z.string().describe('底层 API 真实识别的模型字符串'),
  contextWindow: z.number().int().positive().default(128000).describe('模型最大上下文窗口 token 数'),
  reasoning: z.boolean().default(false).describe('标识该模型是否具备原生思维链能力'),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const MultimodalConfigSchema = z.object({
  stt_provider: z.string().describe('语音转文字 provider 名称'),
  stt_model: z.string().describe('语音转文字模型'),
  vision_provider: z.string().describe('图片理解 provider 名称'),
  vision_model: z.string().describe('图片理解模型'),
});

export type MultimodalConfig = z.infer<typeof MultimodalConfigSchema>;

export const CustomProviderSchema = z.object({
  type: z.enum(['openai_chat', 'openai_completion', 'anthropic']).describe('Provider 类型'),
  api_key: z.string().optional().describe('API Key'),
  base_url: z.string().url().optional().describe('API Base URL'),
  models: z.record(z.string(), ModelConfigSchema).optional().describe('模型能力预设字典'),
});

export type CustomProvider = z.infer<typeof CustomProviderSchema>;

export const ProvidersConfigSchema = z.record(z.string(), CustomProviderSchema);

export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

export const ChannelsConfigSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>;

export const MCPServerConfigSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  stderr: z.enum(['inherit', 'pipe', 'ignore', 'overlapped']).optional(),
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

export const AgentConfigSchema = z.object({
  max_steps: z.number().int().positive().default(100),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const MemoryConfigSchema = z.object({
  max_context_tokens: z.number().int().positive().default(128000),
  compression_threshold: z.number().min(0).max(1).default(0.75).describe('触发压缩的上下文占比阈值 (0.0-1.0)'),
  compression_provider: z.string().optional().describe('已废弃，当前版本由 aesyiu 使用活动模型进行压缩，不再单独指定 provider'),
  compression_model: z.string().optional().describe('已废弃，当前版本由 aesyiu 使用活动模型进行压缩，不再单独指定 model'),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

export const FullConfigSchema = z.object({
  server: ServerConfigSchema,
  providers: ProvidersConfigSchema.optional().default({}),
  channels: ChannelsConfigSchema.optional(),
  agent: AgentConfigSchema,
  memory: MemoryConfigSchema,
  multimodal: MultimodalConfigSchema,
  mcp: MCPConfigSchema.optional(),
  plugins: z.array(PluginConfigSchema).optional().default([]),
});

export type FullConfig = z.infer<typeof FullConfigSchema>;

export const DEFAULT_CONFIG: FullConfig = {
  server: {
    port: 3000,
    host: '0.0.0.0',
    log_level: 'info',
  },
  providers: {
    openai: {
      type: 'openai_chat',
      api_key: 'your-api-key',
      base_url: 'https://api.openai.com/v1',
      models: {
        default: {
          modelname: 'gpt-4o',
          contextWindow: 128000,
          reasoning: false,
        },
      },
    },
  },
  channels: {},
  agent: {
    max_steps: 100,
  },
  memory: {
    max_context_tokens: 128000,
    compression_threshold: 0.75,
  },
  multimodal: {
    stt_provider: 'openai',
    stt_model: 'whisper-1',
    vision_provider: 'openai',
    vision_model: 'gpt-4o-mini',
  },
  mcp: {
    servers: [
      {
        name: 'example',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', './skills'],
        enabled: false,
      },
    ],
  },
  plugins: [],
};
