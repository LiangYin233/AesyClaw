/**
 * TypeBox schema definitions for the application configuration.
 *
 * All configuration shapes that need runtime validation must have
 * a corresponding TypeBox schema here. Compile-time types are
 * derived with `Static<typeof Schema>` — never hand-write both.
 */

import { Type, Static } from '@sinclair/typebox';

// ─── Provider / Model ────────────────────────────────────────────

/** API protocol type */
const ApiProtocolType = Type.Union([
  Type.Literal('openai_responses'),
  Type.Literal('openai_completion'),
  Type.Literal('anthropic'),
]);

/** Model capability preset within a provider */
const ModelPresetSchema = Type.Object({
  realModelName: Type.Optional(Type.String()),
  contextWindow: Type.Optional(Type.Number()),
  enableThinking: Type.Optional(Type.Boolean()),
  apiKey: Type.Optional(Type.String()),
});

type ModelPreset = Static<typeof ModelPresetSchema>;

/** LLM provider configuration */
const ProviderConfigSchema = Type.Object({
  apiKey: Type.Optional(Type.String()),
  baseUrl: Type.Optional(Type.String()),
  apiType: ApiProtocolType,
  models: Type.Optional(Type.Record(Type.String(), ModelPresetSchema)),
});

type ProviderConfig = Static<typeof ProviderConfigSchema>;

// ─── Server ──────────────────────────────────────────────────────

const ServerConfigSchema = Type.Object({
  port: Type.Number({ default: 3000 }),
  host: Type.String({ default: '0.0.0.0' }),
  logLevel: Type.String({ default: 'info' }),
  cors: Type.Optional(Type.Boolean({ default: true })),
});

type ServerConfig = Static<typeof ServerConfigSchema>;

// ─── Agent ───────────────────────────────────────────────────────

const AgentConfigSchema = Type.Object({
  maxSteps: Type.Number({ default: 10 }),
});

type AgentConfig = Static<typeof AgentConfigSchema>;

// ─── Memory ─────────────────────────────────────────────────────

const MemoryConfigSchema = Type.Object({
  maxContextTokens: Type.Number({ default: 128000 }),
  compressionThreshold: Type.Number({ default: 0.8 }),
});

type MemoryConfig = Static<typeof MemoryConfigSchema>;

// ─── Multimodal ──────────────────────────────────────────────────

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

type MultimodalConfig = Static<typeof MultimodalConfigSchema>;

// ─── MCP ─────────────────────────────────────────────────────────

const McpServerConfigSchema = Type.Object({
  name: Type.String(),
  transport: Type.Union([
    Type.Literal('stdio'),
    Type.Literal('sse'),
    Type.Literal('http'),
  ]),
  command: Type.Optional(Type.String()),
  args: Type.Optional(Type.Array(Type.String())),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  url: Type.Optional(Type.String()),
  enabled: Type.Boolean({ default: true }),
});

type McpServerConfig = Static<typeof McpServerConfigSchema>;

// ─── Plugin ──────────────────────────────────────────────────────

const PluginConfigEntrySchema = Type.Object({
  name: Type.String(),
  enabled: Type.Boolean({ default: true }),
  options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

type PluginConfigEntry = Static<typeof PluginConfigEntrySchema>;

// ─── Top-level AppConfig ─────────────────────────────────────────

const AppConfigSchema = Type.Object({
  server: ServerConfigSchema,
  providers: Type.Record(Type.String(), ProviderConfigSchema),
  channels: Type.Record(Type.String(), Type.Unknown()),
  agent: AgentConfigSchema,
  memory: MemoryConfigSchema,
  multimodal: MultimodalConfigSchema,
  mcp: Type.Array(McpServerConfigSchema),
  plugins: Type.Array(PluginConfigEntrySchema),
});

type AppConfig = Static<typeof AppConfigSchema>;

export {
  // Schemas
  ApiProtocolType,
  ModelPresetSchema,
  ProviderConfigSchema,
  ServerConfigSchema,
  AgentConfigSchema,
  MemoryConfigSchema,
  MultimodalConfigSchema,
  McpServerConfigSchema,
  PluginConfigEntrySchema,
  AppConfigSchema,
  // Derived types
  type ModelPreset,
  type ProviderConfig,
  type ServerConfig,
  type AgentConfig,
  type MemoryConfig,
  type MultimodalConfig,
  type McpServerConfig,
  type PluginConfigEntry,
  type AppConfig,
};
