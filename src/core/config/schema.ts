/**
 * 应用配置的 TypeBox 模式定义。
 *
 * 所有需要运行时验证的配置结构都必须在此有对应的 TypeBox 模式。
 * 编译时类型通过 `Static<typeof Schema>` 派生 —— 禁止手写两份。
 */

import { Type, type Static } from '@sinclair/typebox';
import { DEFAULTS } from '@aesyclaw/core/types';
import { ApiType } from '@aesyclaw/agent/agent-types';

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

const MultimodalConfigSchema = Type.Object({
  speechToText: Type.Object({
    provider: Type.String(),
    model: Type.String(),
  }),
  imageUnderstanding: Type.Object({
    provider: Type.String(),
    model: Type.String(),
  }),
});

const AgentConfigSchema = Type.Object({
  memory: MemoryConfigSchema,
  multimodal: MultimodalConfigSchema,
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

// ─── Plugin ──────────────────────────────────────────────────────

const PluginConfigEntrySchema = Type.Object(
  {
    name: Type.String(),
    enabled: Type.Boolean({ default: true }),
    options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
);

type PluginConfigEntry = Static<typeof PluginConfigEntrySchema>;

// ─── Top-level AppConfig ─────────────────────────────────────────

const AppConfigSchema = Type.Object({
  server: ServerConfigSchema,
  providers: Type.Record(Type.String(), ProviderConfigSchema),
  channels: Type.Record(Type.String(), Type.Unknown()),
  agent: AgentConfigSchema,
  mcp: Type.Array(McpServerConfigSchema),
  plugins: Type.Array(PluginConfigEntrySchema),
});

type AppConfig = Static<typeof AppConfigSchema>;

export {
  // 模式
  ApiProtocolSchema,
  ModelPresetSchema,
  ProviderConfigSchema,
  ServerConfigSchema,
  AgentConfigSchema,
  MemoryConfigSchema,
  MultimodalConfigSchema,
  McpServerConfigSchema,
  PluginConfigEntrySchema,
  AppConfigSchema,
  // 派生类型
  type ProviderConfig,
  type McpServerConfig,
  type PluginConfigEntry,
  type AppConfig,
};
