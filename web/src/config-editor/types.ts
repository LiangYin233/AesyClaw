export type McpTransport = 'stdio' | 'sse' | 'http';
export type ApiType = 'openai-responses' | 'openai-completions' | 'anthropic-messages';
export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export interface JsonSchemaRecord extends Record<string, unknown> {
  properties?: Record<string, unknown>;
}

export interface ConfigSectionView {
  key: string;
  title: string;
  subtitle: string;
  schema: Record<string, unknown>;
}

export interface McpServerForm extends Record<string, unknown> {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface ProviderModelForm extends Record<string, unknown> {
  key: string;
  contextWindow?: number;
  extraBody?: Record<string, unknown>;
}

export interface ProviderForm extends Record<string, unknown> {
  key: string;
  apiType: ApiType;
  baseUrl?: string;
  apiKey?: string;
  models: ProviderModelForm[];
}
