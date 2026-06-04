export type PluginEntry = Record<string, unknown> & {
  name: string;
  enabled: boolean;
  options?: Record<string, unknown>;
};

export type ChannelEntry = {
  key: string;
  value: unknown;
};

export type ConfigField = {
  path: string;
  key: string;
  displayLabel: string;
  value: unknown;
  type: 'string' | 'number' | 'boolean' | 'object';
};

export type ApiType = 'openai-responses' | 'openai-completions' | 'anthropic-messages';
export type McpTransport = 'stdio' | 'sse' | 'http';
export type ConfigSectionKey = 'channels' | 'plugins' | 'providers' | 'agent' | 'mcp';
export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export type ProviderModelForm = Record<string, unknown> & {
  key: string;
  contextWindow?: number;
  extraBody?: Record<string, unknown>;
};

export type ProviderForm = Record<string, unknown> & {
  key: string;
  apiType: ApiType;
  baseUrl?: string;
  apiKey?: string;
  models: ProviderModelForm[];
};

export type McpServerForm = Record<string, unknown> & {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
};
