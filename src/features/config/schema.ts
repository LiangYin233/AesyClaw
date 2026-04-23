import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const ServerConfigSchema = Type.Object({
    port: Type.Number({ minimum: 1, maximum: 65535, default: 3000 }),
    host: Type.String({ default: '0.0.0.0' }),
    log_level: Type.Union(
        [Type.Literal('debug'), Type.Literal('info'), Type.Literal('warn'), Type.Literal('error')],
        { default: 'info' },
    ),
    cors_origin: Type.Optional(Type.String()),
});

const ModelConfigSchema = Type.Object({
    modelname: Type.String({ description: '底层 API 真实识别的模型字符串' }),
    contextWindow: Type.Integer({
        minimum: 1,
        default: 128000,
        description: '模型最大上下文窗口 token 数',
    }),
    reasoning: Type.Boolean({
        default: false,
        description: '标识该模型是否具备原生思维链能力',
    }),
});

const MultimodalConfigSchema = Type.Object({
    stt_provider: Type.String({ description: '语音转文字 provider 名称' }),
    stt_model: Type.String({ description: '语音转文字模型' }),
    vision_provider: Type.String({ description: '图片理解 provider 名称' }),
    vision_model: Type.String({ description: '图片理解模型' }),
});

const CustomProviderSchema = Type.Object({
    type: Type.Union(
        [
            Type.Literal('openai_responses'),
            Type.Literal('openai_completion'),
            Type.Literal('anthropic'),
        ],
        { description: 'Provider 类型' },
    ),
    api_key: Type.Optional(Type.String({ description: 'API Key' })),
    base_url: Type.Optional(Type.String({ format: 'uri', description: 'API Base URL' })),
    models: Type.Optional(
        Type.Record(Type.String(), ModelConfigSchema, { description: '模型能力预设字典' }),
    ),
});

const ProvidersConfigSchema = Type.Record(Type.String(), CustomProviderSchema);

export type ProvidersConfig = Static<typeof ProvidersConfigSchema>;

const ChannelsConfigSchema = Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown()));

export type ChannelsConfig = Static<typeof ChannelsConfigSchema>;

const MCPServerConfigSchema = Type.Object({
    name: Type.String(),
    command: Type.String(),
    args: Type.Array(Type.String(), { default: [] }),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    cwd: Type.Optional(Type.String()),
    stderr: Type.Optional(
        Type.Union([
            Type.Literal('inherit'),
            Type.Literal('pipe'),
            Type.Literal('ignore'),
            Type.Literal('overlapped'),
        ]),
    ),
    enabled: Type.Boolean({ default: true }),
});

export type MCPServerConfig = Static<typeof MCPServerConfigSchema>;

const MCPConfigSchema = Type.Object({
    servers: Type.Array(MCPServerConfigSchema, { default: [] }),
});

const PluginConfigSchema = Type.Object({
    name: Type.String(),
    enabled: Type.Boolean({ default: true }),
    options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const RuntimeAgentConfigSchema = Type.Object({
    max_steps: Type.Integer({ minimum: 1, default: 100 }),
});

const RuntimeMemoryConfigSchema = Type.Object({
    max_context_tokens: Type.Integer({ minimum: 1, default: 128000 }),
    compression_threshold: Type.Number({
        minimum: 0,
        maximum: 1,
        default: 0.75,
        description: '触发压缩的上下文占比阈值 (0.0-1.0)',
    }),
});

export const FullConfigSchema = Type.Object({
    server: ServerConfigSchema,
    providers: ProvidersConfigSchema,
    channels: ChannelsConfigSchema,
    agent: RuntimeAgentConfigSchema,
    memory: RuntimeMemoryConfigSchema,
    multimodal: MultimodalConfigSchema,
    mcp: MCPConfigSchema,
    plugins: Type.Array(PluginConfigSchema),
});

export type FullConfig = Static<typeof FullConfigSchema>;

export const DEFAULT_CONFIG: FullConfig = {
    server: {
        port: 3000,
        host: '0.0.0.0',
        log_level: 'info',
    },
    providers: {
        openai: {
            type: 'openai_responses',
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
        servers: [],
    },
    plugins: [],
};

/** 验证配置并返回结果 */
export function validateConfig(data: unknown): {
    success: true;
    data: FullConfig;
} | {
    success: false;
    errors: Array<{ path: string; message: string }>;
} {
    if (!Value.Check(FullConfigSchema, data)) {
        const errors = [...Value.Errors(FullConfigSchema, data)].map((e) => ({
            path: e.path || 'unknown',
            message: e.message,
        }));
        return { success: false, errors };
    }
    return { success: true, data: data as FullConfig };
}
