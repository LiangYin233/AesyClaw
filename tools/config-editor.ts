#!/usr/bin/env tsx

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { PathResolver } from '../src/core/path-resolver';
import { DEFAULT_CONFIG } from '../src/core/config/defaults';
import {
  AgentConfigSchema,
  AppConfigSchema,
  McpServerConfigSchema,
  MemoryConfigSchema,
  MultimodalConfigSchema,
  PluginConfigEntrySchema,
  ProviderConfigSchema,
  ServerConfigSchema,
} from '../src/core/config/schema';
import type {
  AppConfig,
  McpServerConfig,
  PluginConfigEntry,
  ProviderConfig,
} from '../src/core/config/schema';

type ConfigSection = keyof AppConfig;

type SectionEditor = (rl: Interface, config: AppConfig) => Promise<AppConfig>;

const SECTION_DEFINITIONS: ReadonlyArray<{
  key: ConfigSection;
  label: string;
  editor: SectionEditor;
}> = [
  { key: 'server', label: 'Edit server', editor: editServer },
  { key: 'providers', label: 'Edit providers', editor: editProviders },
  { key: 'channels', label: 'Edit channels', editor: editChannels },
  { key: 'agent', label: 'Edit agent', editor: editAgent },
  { key: 'memory', label: 'Edit memory', editor: editMemory },
  { key: 'multimodal', label: 'Edit multimodal', editor: editMultimodal },
  { key: 'mcp', label: 'Edit MCP servers', editor: editMcpServers },
  { key: 'plugins', label: 'Edit plugins', editor: editPlugins },
];

export function resolveConfigPath(root = process.cwd()): string {
  const resolver = new PathResolver();
  resolver.resolve(path.resolve(root));
  return resolver.configFile;
}

export function validateConfig(value: unknown): AppConfig {
  const candidate = Value.Default(AppConfigSchema, value);

  if (!Value.Check(AppConfigSchema, candidate)) {
    const errors = [...Value.Errors(AppConfigSchema, candidate)]
      .map((error) => `${error.path || '/'}: ${error.message}`)
      .join('\n');
    throw new Error(`Config validation failed:\n${errors}`);
  }

  return candidate as AppConfig;
}

export async function loadConfig(configPath: string): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath, 'utf-8');
    return validateConfig(JSON.parse(raw));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      const config = structuredClone(DEFAULT_CONFIG);
      await saveConfig(configPath, config);
      return config;
    }
    throw error;
  }
}

export async function saveConfig(configPath: string, config: AppConfig): Promise<void> {
  const validConfig = validateConfig(config);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(validConfig, null, 2)}\n`, 'utf-8');
}

export function upsertProvider(
  config: AppConfig,
  name: string,
  provider: ProviderConfig,
): AppConfig {
  return {
    ...config,
    providers: {
      ...config.providers,
      [name]: provider,
    },
  };
}

export function removeProvider(config: AppConfig, name: string): AppConfig {
  const providers = { ...config.providers };
  delete providers[name];
  return { ...config, providers };
}

export function upsertChannel(
  config: AppConfig,
  name: string,
  channelConfig: Record<string, unknown>,
): AppConfig {
  return {
    ...config,
    channels: {
      ...config.channels,
      [name]: channelConfig,
    },
  };
}

export function removeChannel(config: AppConfig, name: string): AppConfig {
  const channels = { ...config.channels };
  delete channels[name];
  return { ...config, channels };
}

export function upsertMcpServer(config: AppConfig, server: McpServerConfig): AppConfig {
  const existingIndex = config.mcp.findIndex((candidate) => candidate.name === server.name);
  const mcp = [...config.mcp];

  if (existingIndex >= 0) {
    mcp[existingIndex] = server;
  } else {
    mcp.push(server);
  }

  return { ...config, mcp };
}

export function removeMcpServer(config: AppConfig, name: string): AppConfig {
  return { ...config, mcp: config.mcp.filter((server) => server.name !== name) };
}

export function upsertPlugin(config: AppConfig, plugin: PluginConfigEntry): AppConfig {
  const existingIndex = config.plugins.findIndex((candidate) => candidate.name === plugin.name);
  const plugins = [...config.plugins];

  if (existingIndex >= 0) {
    plugins[existingIndex] = plugin;
  } else {
    plugins.push(plugin);
  }

  return { ...config, plugins };
}

export function removePlugin(config: AppConfig, name: string): AppConfig {
  return { ...config, plugins: config.plugins.filter((plugin) => plugin.name !== name) };
}

export async function runConfigEditor(configPath = resolveConfigPath()): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    let config = await loadConfig(configPath);
    let dirty = false;

    writeLine('AesyClaw Config Editor');
    writeLine(`Config: ${configPath}`);

    while (true) {
      const action = await choose(rl, 'Main menu', [
        ...SECTION_DEFINITIONS.map((section) => ({ label: section.label, value: section.key })),
        { label: 'Preview config', value: 'preview' as const },
        { label: 'Save and exit', value: 'save' as const },
        { label: 'Exit without saving', value: 'exit' as const },
      ]);

      if (action === 'save') {
        await saveConfig(configPath, config);
        writeLine('Config saved.');
        return;
      }

      if (action === 'exit') {
        if (!dirty || (await promptBoolean(rl, 'Discard unsaved changes?', false))) {
          return;
        }
        continue;
      }

      if (action === 'preview') {
        writeLine(JSON.stringify(config, null, 2));
        continue;
      }

      config = await editSection(rl, action, config);
      dirty = true;
    }
  } finally {
    rl.close();
  }
}

async function editSection(
  rl: Interface,
  section: ConfigSection,
  config: AppConfig,
): Promise<AppConfig> {
  const definition = SECTION_DEFINITIONS.find((candidate) => candidate.key === section);
  if (!definition) {
    throw new Error(`Unsupported config section: ${section}`);
  }

  return definition.editor(rl, config);
}

async function editServer(rl: Interface, config: AppConfig): Promise<AppConfig> {
  const server = config.server;
  return {
    ...config,
    server: (await editObjectBySchema(
      rl,
      ServerConfigSchema,
      server,
      'Server',
    )) as AppConfig['server'],
  };
}

async function editAgent(rl: Interface, config: AppConfig): Promise<AppConfig> {
  return {
    ...config,
    agent: (await editObjectBySchema(
      rl,
      AgentConfigSchema,
      config.agent,
      'Agent',
    )) as AppConfig['agent'],
  };
}

async function editMemory(rl: Interface, config: AppConfig): Promise<AppConfig> {
  return {
    ...config,
    memory: (await editObjectBySchema(
      rl,
      MemoryConfigSchema,
      config.memory,
      'Memory',
    )) as AppConfig['memory'],
  };
}

async function editMultimodal(rl: Interface, config: AppConfig): Promise<AppConfig> {
  return {
    ...config,
    multimodal: (await editObjectBySchema(
      rl,
      MultimodalConfigSchema,
      config.multimodal,
      'Multimodal',
    )) as AppConfig['multimodal'],
  };
}

async function editProviders(rl: Interface, config: AppConfig): Promise<AppConfig> {
  let current = config;

  while (true) {
    const names = Object.keys(current.providers).sort();
    const action = await choose(rl, `Providers (${names.length})`, [
      { label: 'Add or update provider', value: 'upsert' as const },
      { label: 'Remove provider', value: 'remove' as const },
      { label: 'Back', value: 'back' as const },
    ]);

    if (action === 'back') return current;

    if (action === 'remove') {
      const name = await chooseName(rl, 'Provider to remove', names);
      if (name) current = removeProvider(current, name);
      continue;
    }

    const name = await promptString(rl, 'Provider name');
    const existing = current.providers[name];
    const provider = await editProvider(rl, existing);
    current = upsertProvider(current, name, provider);
  }
}

async function editProvider(
  rl: Interface,
  existing?: Readonly<ProviderConfig>,
): Promise<ProviderConfig> {
  return (await editObjectBySchema(
    rl,
    ProviderConfigSchema,
    existing ?? {},
    'Provider',
  )) as ProviderConfig;
}

async function editChannels(rl: Interface, config: AppConfig): Promise<AppConfig> {
  let current = config;

  while (true) {
    const names = Object.keys(current.channels).sort();
    const action = await choose(rl, `Channels (${names.length})`, [
      { label: 'Add or update channel', value: 'upsert' as const },
      { label: 'Remove channel', value: 'remove' as const },
      { label: 'Back', value: 'back' as const },
    ]);

    if (action === 'back') return current;

    if (action === 'remove') {
      const name = await chooseName(rl, 'Channel to remove', names);
      if (name) current = removeChannel(current, name);
      continue;
    }

    const name = await promptString(rl, 'Channel name');
    const channelConfig = await promptJsonObject(
      rl,
      'Channel config JSON object',
      current.channels[name],
    );
    current = upsertChannel(current, name, channelConfig);
  }
}

async function editMcpServers(rl: Interface, config: AppConfig): Promise<AppConfig> {
  let current = config;

  while (true) {
    const names = current.mcp.map((server) => server.name).sort();
    const action = await choose(rl, `MCP servers (${names.length})`, [
      { label: 'Add or update MCP server', value: 'upsert' as const },
      { label: 'Remove MCP server', value: 'remove' as const },
      { label: 'Back', value: 'back' as const },
    ]);

    if (action === 'back') return current;

    if (action === 'remove') {
      const name = await chooseName(rl, 'MCP server to remove', names);
      if (name) current = removeMcpServer(current, name);
      continue;
    }

    const name = await promptString(rl, 'MCP server name');
    const existing = current.mcp.find((server) => server.name === name);
    current = upsertMcpServer(current, await editMcpServer(rl, name, existing));
  }
}

async function editMcpServer(
  rl: Interface,
  name: string,
  existing?: Readonly<McpServerConfig>,
): Promise<McpServerConfig> {
  const edited = await editObjectBySchema(
    rl,
    McpServerConfigSchema,
    { ...(existing ?? {}), name },
    'MCP server',
    { skipKeys: ['name'] },
  );

  return { ...(edited as McpServerConfig), name };
}

async function editPlugins(rl: Interface, config: AppConfig): Promise<AppConfig> {
  let current = config;

  while (true) {
    const names = current.plugins.map((plugin) => plugin.name).sort();
    const action = await choose(rl, `Plugins (${names.length})`, [
      { label: 'Add or update plugin', value: 'upsert' as const },
      { label: 'Remove plugin', value: 'remove' as const },
      { label: 'Back', value: 'back' as const },
    ]);

    if (action === 'back') return current;

    if (action === 'remove') {
      const name = await chooseName(rl, 'Plugin to remove', names);
      if (name) current = removePlugin(current, name);
      continue;
    }

    const name = await promptString(rl, 'Plugin name');
    const existing = current.plugins.find((plugin) => plugin.name === name);
    const plugin = await editPlugin(rl, name, existing);
    current = upsertPlugin(current, plugin);
  }
}

async function editPlugin(
  rl: Interface,
  name: string,
  existing?: Readonly<PluginConfigEntry>,
): Promise<PluginConfigEntry> {
  const edited = await editObjectBySchema(
    rl,
    PluginConfigEntrySchema,
    { ...(existing ?? {}), name },
    'Plugin',
    { skipKeys: ['name'] },
  );

  return { ...(edited as PluginConfigEntry), name };
}

interface SchemaEditOptions {
  skipKeys?: readonly string[];
}

async function editObjectBySchema(
  rl: Interface,
  schema: TSchema,
  current: Record<string, unknown>,
  labelPrefix: string,
  options: SchemaEditOptions = {},
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  const properties = getSchemaProperties(schema);
  const requiredKeys = new Set(getRequiredKeys(schema));

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (options.skipKeys?.includes(key)) {
      continue;
    }

    const label = `${labelPrefix} ${humanizeKey(key)}`.trim();
    const currentValue = current[key];
    const value = await editValueBySchema(
      rl,
      propertySchema,
      currentValue,
      label,
      requiredKeys.has(key),
    );

    if (value !== undefined) {
      result[key] = value;
    }
  }

  return stripUndefined(result);
}

async function editValueBySchema(
  rl: Interface,
  schema: TSchema,
  current: unknown,
  label: string,
  required: boolean,
): Promise<unknown> {
  if (isLiteralUnionSchema(schema)) {
    const options = schema.anyOf.map((option) => ({
      label: String(option.const),
      value: option.const,
    }));
    return chooseWithDefault(rl, label, options, current);
  }

  if (isObjectSchema(schema)) {
    const currentObject = isRecord(current) ? current : {};

    if (hasSchemaProperties(schema)) {
      return editObjectBySchema(rl, schema, currentObject, label);
    }

    if (isRecordSchema(schema)) {
      return editRecordBySchema(rl, label, currentObject, schema);
    }

    return promptJsonObject(rl, `${label} JSON object`, currentObject);
  }

  if (schema.type === 'array') {
    if (isStringArraySchema(schema)) {
      return promptStringArray(
        rl,
        label,
        Array.isArray(current) ? stringifyArray(current) : undefined,
      );
    }

    return promptJsonArray(rl, `${label} JSON array`, Array.isArray(current) ? current : undefined);
  }

  if (schema.type === 'string') {
    if (required) {
      return isSecretLabel(label)
        ? promptRequiredSecretLikeString(rl, label, asOptionalString(current))
        : promptString(rl, label, asOptionalString(current));
    }

    return isSecretLabel(label)
      ? promptSecretLikeString(rl, label, asOptionalString(current))
      : promptOptionalString(rl, label, asOptionalString(current));
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    const fallback =
      typeof current === 'number'
        ? current
        : typeof schema.default === 'number'
          ? schema.default
          : 0;
    return required
      ? promptNumber(rl, label, fallback)
      : promptOptionalNumber(rl, label, asOptionalNumber(current));
  }

  if (schema.type === 'boolean') {
    const fallback =
      typeof current === 'boolean'
        ? current
        : typeof schema.default === 'boolean'
          ? schema.default
          : false;
    return required
      ? promptBoolean(rl, label, fallback)
      : promptOptionalBoolean(rl, label, asOptionalBoolean(current));
  }

  return promptJsonValue(rl, `${label} JSON value`, current);
}

async function editRecordBySchema(
  rl: Interface,
  label: string,
  current: Record<string, unknown>,
  schema: TSchema,
): Promise<Record<string, unknown> | undefined> {
  const valueSchema = getRecordValueSchema(schema);
  if (!valueSchema) {
    return promptJsonObject(rl, `${label} JSON object`, current);
  }

  const entries = structuredClone(current);

  while (true) {
    const names = Object.keys(entries).sort();
    const action = await choose(rl, `${label} (${names.length})`, [
      { label: `Add or update ${label.toLowerCase()} entry`, value: 'upsert' as const },
      { label: `Remove ${label.toLowerCase()} entry`, value: 'remove' as const },
      { label: 'Back', value: 'back' as const },
    ]);

    if (action === 'back') {
      return Object.keys(entries).length > 0 ? entries : undefined;
    }

    if (action === 'remove') {
      const name = await chooseName(rl, `${label} entry to remove`, names);
      if (name) {
        delete entries[name];
      }
      continue;
    }

    const name = await promptString(rl, `${label} entry name`);
    entries[name] = await editValueBySchema(
      rl,
      valueSchema,
      entries[name],
      `${label} ${humanizeKey(name)}`,
      true,
    );
  }
}

function getSchemaProperties(schema: TSchema): Record<string, TSchema> {
  return hasSchemaProperties(schema) ? (schema.properties as Record<string, TSchema>) : {};
}

function getRequiredKeys(schema: TSchema): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : [];
}

function hasSchemaProperties(
  schema: TSchema,
): schema is TSchema & { properties: Record<string, TSchema> } {
  return isRecord(schema.properties);
}

function isObjectSchema(schema: TSchema): boolean {
  return schema.type === 'object';
}

function isStringArraySchema(schema: TSchema): schema is TSchema & { items: TSchema } {
  return schema.type === 'array' && isRecord(schema.items) && schema.items.type === 'string';
}

function isRecordSchema(schema: TSchema): boolean {
  return isObjectSchema(schema) && isRecord(schema.patternProperties);
}

function getRecordValueSchema(schema: TSchema): TSchema | null {
  if (!isRecord(schema.patternProperties)) {
    return null;
  }

  const firstValue = Object.values(schema.patternProperties)[0];
  return isRecord(firstValue) ? (firstValue as TSchema) : null;
}

function isLiteralUnionSchema(
  schema: TSchema,
): schema is TSchema & { anyOf: Array<TSchema & { const: string | number | boolean }> } {
  return (
    Array.isArray(schema.anyOf) &&
    schema.anyOf.length > 0 &&
    schema.anyOf.every((option) => isRecord(option) && 'const' in option)
  );
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (value) => value.toUpperCase());
}

function isSecretLabel(label: string): boolean {
  return /(api key|token|secret|password)/i.test(label);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringifyArray(value: readonly unknown[]): string[] {
  return value.filter((entry): entry is string => typeof entry === 'string');
}

async function choose<T>(
  rl: Interface,
  title: string,
  options: ReadonlyArray<{ label: string; value: T }>,
): Promise<T> {
  while (true) {
    writeLine(`\n${title}`);
    options.forEach((option, index) => {
      writeLine(`  ${index + 1}. ${option.label}`);
    });

    const raw = (await rl.question('Choose: ')).trim();
    const index = Number(raw) - 1;
    if (Number.isInteger(index) && index >= 0 && index < options.length) {
      return options[index].value;
    }

    writeLine('Invalid choice. Enter the number from the menu.');
  }
}

async function chooseWithDefault<T>(
  rl: Interface,
  title: string,
  options: ReadonlyArray<{ label: string; value: T }>,
  current?: T,
): Promise<T> {
  while (true) {
    writeLine(`\n${title}`);
    options.forEach((option, index) => {
      const suffix = current === option.value ? ' [current]' : '';
      writeLine(`  ${index + 1}. ${option.label}${suffix}`);
    });

    const raw = (await rl.question('Choose: ')).trim();
    if (raw === '' && current !== undefined) return current;

    const index = Number(raw) - 1;
    if (Number.isInteger(index) && index >= 0 && index < options.length) {
      return options[index].value;
    }

    writeLine('Invalid choice. Enter the number from the menu.');
  }
}

async function chooseName(
  rl: Interface,
  label: string,
  names: readonly string[],
): Promise<string | null> {
  if (names.length === 0) {
    writeLine('Nothing to remove.');
    return null;
  }

  return choose(
    rl,
    label,
    names.map((name) => ({ label: name, value: name })),
  );
}

async function promptString(rl: Interface, label: string, current?: string): Promise<string> {
  while (true) {
    const raw = await promptRaw(rl, label, current);
    if (raw !== '') return raw;
    if (current !== undefined) return current;
    writeLine('Value is required.');
  }
}

async function promptOptionalString(
  rl: Interface,
  label: string,
  current?: string,
): Promise<string | undefined> {
  const raw = await promptRaw(rl, `${label} (blank keeps, '-' clears)`, current);
  if (raw === '') return current;
  if (raw === '-') return undefined;
  return raw;
}

async function promptSecretLikeString(
  rl: Interface,
  label: string,
  current?: string,
): Promise<string | undefined> {
  const suffix = current ? ' (currently set; blank keeps, - clears)' : ' (blank skips)';
  const raw = (await rl.question(`${label}${suffix}: `)).trim();
  if (raw === '') return current;
  if (raw === '-') return undefined;
  return raw;
}

async function promptRequiredSecretLikeString(
  rl: Interface,
  label: string,
  current?: string,
): Promise<string> {
  while (true) {
    const value = await promptSecretLikeString(rl, label, current);
    if (value && value.length > 0) {
      return value;
    }
    if (current && current.length > 0) {
      return current;
    }
    writeLine('Value is required.');
  }
}

async function promptNumber(rl: Interface, label: string, current: number): Promise<number> {
  while (true) {
    const raw = await promptRaw(rl, label, String(current));
    if (raw === '') return current;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
    writeLine('Enter a valid number.');
  }
}

async function promptOptionalNumber(
  rl: Interface,
  label: string,
  current?: number,
): Promise<number | undefined> {
  while (true) {
    const raw = await promptRaw(rl, `${label} (blank keeps, '-' clears)`, formatCurrent(current));
    if (raw === '') return current;
    if (raw === '-') return undefined;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
    writeLine('Enter a valid number.');
  }
}

async function promptBoolean(rl: Interface, label: string, current: boolean): Promise<boolean> {
  while (true) {
    const raw = await promptRaw(rl, `${label} (y/n)`, current ? 'y' : 'n');
    if (raw === '') return current;
    const normalized = raw.toLowerCase();
    if (['y', 'yes', 'true', '1'].includes(normalized)) return true;
    if (['n', 'no', 'false', '0'].includes(normalized)) return false;
    writeLine('Enter y or n.');
  }
}

async function promptOptionalBoolean(
  rl: Interface,
  label: string,
  current?: boolean,
): Promise<boolean | undefined> {
  while (true) {
    const raw = await promptRaw(
      rl,
      `${label} (y/n, blank keeps, '-' clears)`,
      current === undefined ? undefined : current ? 'y' : 'n',
    );
    if (raw === '') return current;
    if (raw === '-') return undefined;
    const normalized = raw.toLowerCase();
    if (['y', 'yes', 'true', '1'].includes(normalized)) return true;
    if (['n', 'no', 'false', '0'].includes(normalized)) return false;
    writeLine('Enter y, n, or -.');
  }
}

async function promptStringArray(
  rl: Interface,
  label: string,
  current?: readonly string[],
): Promise<string[] | undefined> {
  const raw = await promptRaw(
    rl,
    `${label} as comma-separated values (blank keeps, '-' clears)`,
    current?.join(', '),
  );

  if (raw === '') return current ? [...current] : undefined;
  if (raw === '-') return undefined;
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function promptJsonObject(
  rl: Interface,
  label: string,
  current?: unknown,
): Promise<Record<string, unknown>> {
  const currentObject = isRecord(current) ? current : {};

  while (true) {
    writeLine(`Current ${label}: ${JSON.stringify(currentObject)}`);
    const raw = await promptRaw(rl, `${label} (blank keeps, '-' clears)`, undefined);
    if (raw === '') return { ...currentObject };
    if (raw === '-') return {};

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isRecord(parsed)) return parsed;
      writeLine('Enter a JSON object, for example: {"enabled":true}');
    } catch (error) {
      writeLine(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function promptJsonArray(
  rl: Interface,
  label: string,
  current?: readonly unknown[],
): Promise<unknown[] | undefined> {
  while (true) {
    writeLine(`Current ${label}: ${JSON.stringify(current ?? [])}`);
    const raw = await promptRaw(rl, `${label} (blank keeps, '-' clears)`, undefined);
    if (raw === '') return current ? [...current] : undefined;
    if (raw === '-') return undefined;

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed;
      writeLine('Enter a JSON array, for example: ["value"]');
    } catch (error) {
      writeLine(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function promptJsonValue(rl: Interface, label: string, current?: unknown): Promise<unknown> {
  while (true) {
    writeLine(`Current ${label}: ${JSON.stringify(current)}`);
    const raw = await promptRaw(rl, `${label} (blank keeps, '-' clears)`, undefined);
    if (raw === '') return current;
    if (raw === '-') return undefined;

    try {
      return JSON.parse(raw) as unknown;
    } catch (error) {
      writeLine(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function promptRaw(rl: Interface, label: string, current?: string): Promise<string> {
  const suffix = current === undefined || current === '' ? '' : ` [${current}]`;
  return (await rl.question(`${label}${suffix}: `)).trim();
}

function formatCurrent(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}

function writeLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

function parseConfigPathArg(argv: readonly string[]): string {
  let root = process.cwd();
  let configPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--root') {
      if (!next) throw new Error('--root requires a path');
      root = next;
      index += 1;
      continue;
    }

    if (arg === '--config') {
      if (!next) throw new Error('--config requires a path');
      configPath = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return path.resolve(configPath ?? resolveConfigPath(root));
}

function printHelp(): void {
  writeLine('Usage: yarn config:edit [--root <path>] [--config <path>]');
  writeLine('');
  writeLine('Options:');
  writeLine('  --root <path>    Project root used to resolve .aesyclaw/config.json');
  writeLine('  --config <path>  Explicit config file path');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runConfigEditor(parseConfigPathArg(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
