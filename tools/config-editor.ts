#!/usr/bin/env tsx

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { Value } from '@sinclair/typebox/value';
import { PathResolver } from '../src/core/path-resolver';
import { DEFAULT_CONFIG } from '../src/core/config/defaults';
import { AppConfigSchema } from '../src/core/config/schema';
import type {
  AppConfig,
  McpServerConfig,
  ModelPreset,
  PluginConfigEntry,
  ProviderConfig,
} from '../src/core/config/schema';

type ApiType = ProviderConfig['apiType'];
type McpTransport = McpServerConfig['transport'];
type ConfigSection = keyof AppConfig;

const API_TYPES: readonly ApiType[] = ['openai_responses', 'openai_completion', 'anthropic'];
const MCP_TRANSPORTS: readonly McpTransport[] = ['stdio', 'sse', 'http'];

export function resolveConfigPath(root = process.cwd()): string {
  const resolver = new PathResolver();
  resolver.resolve(path.resolve(root));
  return resolver.configFile;
}

export function validateConfig(value: unknown): AppConfig {
  const candidate = Value.Check(AppConfigSchema, value)
    ? value
    : Value.Cast(AppConfigSchema, value);

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
        { label: 'Edit server', value: 'server' as const },
        { label: 'Edit providers', value: 'providers' as const },
        { label: 'Edit channels', value: 'channels' as const },
        { label: 'Edit agent', value: 'agent' as const },
        { label: 'Edit memory', value: 'memory' as const },
        { label: 'Edit multimodal', value: 'multimodal' as const },
        { label: 'Edit MCP servers', value: 'mcp' as const },
        { label: 'Edit plugins', value: 'plugins' as const },
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
  switch (section) {
    case 'server':
      return editServer(rl, config);
    case 'providers':
      return editProviders(rl, config);
    case 'channels':
      return editChannels(rl, config);
    case 'agent':
      return editAgent(rl, config);
    case 'memory':
      return editMemory(rl, config);
    case 'multimodal':
      return editMultimodal(rl, config);
    case 'mcp':
      return editMcpServers(rl, config);
    case 'plugins':
      return editPlugins(rl, config);
  }
}

async function editServer(rl: Interface, config: AppConfig): Promise<AppConfig> {
  const server = config.server;
  return {
    ...config,
    server: {
      port: await promptNumber(rl, 'Server port', server.port),
      host: await promptString(rl, 'Server host', server.host),
      logLevel: await promptString(rl, 'Log level', server.logLevel),
      cors: await promptBoolean(rl, 'Enable CORS', server.cors ?? true),
    },
  };
}

async function editAgent(rl: Interface, config: AppConfig): Promise<AppConfig> {
  return {
    ...config,
    agent: {
      maxSteps: await promptNumber(rl, 'Agent max steps', config.agent.maxSteps),
    },
  };
}

async function editMemory(rl: Interface, config: AppConfig): Promise<AppConfig> {
  return {
    ...config,
    memory: {
      maxContextTokens: await promptNumber(
        rl,
        'Max context tokens',
        config.memory.maxContextTokens,
      ),
      compressionThreshold: await promptNumber(
        rl,
        'Compression threshold',
        config.memory.compressionThreshold,
      ),
    },
  };
}

async function editMultimodal(rl: Interface, config: AppConfig): Promise<AppConfig> {
  const multimodal = config.multimodal;
  return {
    ...config,
    multimodal: {
      speechToText: {
        provider: await promptString(
          rl,
          'Speech-to-text provider',
          multimodal.speechToText.provider,
        ),
        model: await promptString(rl, 'Speech-to-text model', multimodal.speechToText.model),
      },
      imageUnderstanding: {
        provider: await promptString(
          rl,
          'Image understanding provider',
          multimodal.imageUnderstanding.provider,
        ),
        model: await promptString(
          rl,
          'Image understanding model',
          multimodal.imageUnderstanding.model,
        ),
      },
    },
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
  const apiType = await chooseWithDefault(
    rl,
    'API type',
    API_TYPES.map((value) => ({ label: value, value })),
    existing?.apiType,
  );
  const baseUrl = await promptOptionalString(rl, 'Base URL', existing?.baseUrl);
  const apiKey = await promptSecretLikeString(
    rl,
    'API key (required for runtime calls)',
    existing?.apiKey,
  );
  const models = await editModelPresets(rl, existing?.models ?? {});

  return stripUndefined({
    apiType,
    baseUrl,
    apiKey,
    models: Object.keys(models).length > 0 ? models : undefined,
  });
}

async function editModelPresets(
  rl: Interface,
  existingModels: Readonly<Record<string, ModelPreset>>,
): Promise<Record<string, ModelPreset>> {
  const models: Record<string, ModelPreset> = structuredClone(existingModels);

  while (true) {
    const names = Object.keys(models).sort();
    const action = await choose(rl, `Model presets (${names.length})`, [
      { label: 'Add or update model preset', value: 'upsert' as const },
      { label: 'Remove model preset', value: 'remove' as const },
      { label: 'Back', value: 'back' as const },
    ]);

    if (action === 'back') return models;

    if (action === 'remove') {
      const name = await chooseName(rl, 'Model preset to remove', names);
      if (name) delete models[name];
      continue;
    }

    const name = await promptString(rl, 'Model preset name');
    models[name] = await editModelPreset(rl, models[name]);
  }
}

async function editModelPreset(
  rl: Interface,
  existing?: Readonly<ModelPreset>,
): Promise<ModelPreset> {
  return stripUndefined({
    realModelName: await promptOptionalString(rl, 'Real model name', existing?.realModelName),
    contextWindow: await promptOptionalNumber(rl, 'Context window', existing?.contextWindow),
    enableThinking: await promptOptionalBoolean(rl, 'Enable thinking', existing?.enableThinking),
    apiKey: await promptSecretLikeString(rl, 'Model API key override', existing?.apiKey),
  });
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
  const transport = await chooseWithDefault(
    rl,
    'MCP transport',
    MCP_TRANSPORTS.map((value) => ({ label: value, value })),
    existing?.transport,
  );

  return stripUndefined({
    name,
    transport,
    command: await promptOptionalString(rl, 'Command', existing?.command),
    args: await promptStringArray(rl, 'Args', existing?.args),
    env: await promptOptionalStringRecord(rl, 'Environment variables', existing?.env),
    url: await promptOptionalString(rl, 'URL', existing?.url),
    enabled: await promptBoolean(rl, 'Enabled', existing?.enabled ?? true),
  });
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
  return stripUndefined({
    name,
    enabled: await promptBoolean(rl, 'Enabled', existing?.enabled ?? true),
    options: await promptJsonObject(rl, 'Plugin options JSON object', existing?.options),
  });
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

async function promptOptionalStringRecord(
  rl: Interface,
  label: string,
  current?: Readonly<Record<string, string>>,
): Promise<Record<string, string> | undefined> {
  while (true) {
    const parsed = await promptJsonObject(rl, `${label} JSON object`, current);
    const entries = Object.entries(parsed);

    if (entries.length === 0) return undefined;
    const invalidKey = entries.find(([, value]) => typeof value !== 'string')?.[0];
    if (!invalidKey) return Object.fromEntries(entries) as Record<string, string>;

    writeLine(`All ${label} values must be strings. Re-enter the object or use '-'.`);
  }
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
