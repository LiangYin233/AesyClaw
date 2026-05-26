/**
 * 应用配置的 TypeBox 模式定义。
 *
 * 所有需要运行时验证的配置结构都必须在此有对应的 TypeBox 模式。
 * 编译时类型通过 `Static<typeof Schema>` 派生 —— 禁止手写两份。
 */

import { Type, type Static } from '@sinclair/typebox';
import { DEFAULTS } from '@aesyclaw/core/types';
import { ApiType } from '@aesyclaw/contracts/llm';

// ─── Provider / Model ────────────────────────────────────────────

const ApiProtocolSchema = Type.Union([
  Type.Literal(ApiType.OPENAI_RESPONSES),
  Type.Literal(ApiType.OPENAI_COMPLETIONS),
  Type.Literal(ApiType.ANTHROPIC_MESSAGES),
]);

/** 提供商内的模型能力预设 */
const ModelPresetSchema = Type.Object({
  contextWindow: Type.Optional(Type.Number()),
  extraBody: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  input: Type.Optional(Type.Array(Type.String())),
});

const ProviderConfigSchema = Type.Object(
  {
    apiKey: Type.Optional(Type.String()),
    baseUrl: Type.Optional(Type.String()),
    apiType: ApiProtocolSchema,
    models: Type.Record(Type.String(), ModelPresetSchema, { default: {} }),
  },
  { additionalProperties: true },
);

type ProviderConfig = Static<typeof ProviderConfigSchema>;

// ─── Server ──────────────────────────────────────────────────────

const ServerConfigSchema = Type.Object({
  port: Type.Number({ default: DEFAULTS.port }),
  host: Type.String({ default: DEFAULTS.host }),
  logLevel: Type.String({ default: DEFAULTS.logLevel }),
  authToken: Type.Optional(Type.String()),
});

// ─── Agent ───────────────────────────────────────────────────────

const MemoryConfigSchema = Type.Object({
  compressionThreshold: Type.Number({ default: DEFAULTS.compressionThreshold }),
});

const AgentConfigSchema = Type.Object({
  memory: MemoryConfigSchema,
});

// ─── MCP ─────────────────────────────────────────────────────────

const McpServerConfigSchema = Type.Object(
  {
    name: Type.String(),
    transport: Type.Union([Type.Literal('stdio'), Type.Literal('sse'), Type.Literal('http')]),
    command: Type.Optional(Type.String()),
    args: Type.Optional(Type.Array(Type.String())),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    url: Type.Optional(Type.String()),
    enabled: Type.Boolean({ default: true }),
  },
  { additionalProperties: true },
);

type McpServerConfig = Static<typeof McpServerConfigSchema>;


// ─── Top-level AppConfig ─────────────────────────────────────────

const AppConfigSchema = Type.Object({
  server: ServerConfigSchema,
  providers: Type.Record(Type.String(), ProviderConfigSchema),
  /**
   * 频道配置以名称-值对的方式存储。由于频道是运行时从磁盘发现的动态扩展，
   * 顶层无法预知所有频道名，因此值类型为 Unknown。
   * 每个频道应在自身的 init() 中使用 validateWithSchema() 做运行时校验。
   */
  channels: Type.Record(Type.String(), Type.Unknown()),
  agent: AgentConfigSchema,
  mcp: Type.Array(McpServerConfigSchema),
  plugins: Type.Record(Type.String(), Type.Unknown()),
});

type AppConfig = Static<typeof AppConfigSchema>;

export {
  // 模式
  /** 提供商 API 协议类型联合模式 */
  ApiProtocolSchema,
  /** 模型能力预设模式 */
  ModelPresetSchema,
  /** 提供商配置模式（含 API 密钥、端点、模型列表） */
  ProviderConfigSchema,
  /** 服务器配置模式 */
  ServerConfigSchema,
  /** 代理配置模式 */
  /** 代理配置模式 */
  AgentConfigSchema,
  /** 记忆压缩配置模式 */
  MemoryConfigSchema,
  /** MCP 服务器配置模式 */
  McpServerConfigSchema,

  /** 顶层应用配置模式 */
  AppConfigSchema,
  // 派生类型
  type ProviderConfig,
  type McpServerConfig,
  type AppConfig,
};
