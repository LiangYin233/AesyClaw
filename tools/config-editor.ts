#!/usr/bin/env tsx

import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import React, { useEffect, useState } from 'react';
import { Box, render, Text, useApp, useInput } from 'ink';
import { PathResolver } from '../src/core/path-resolver';
import { DEFAULT_CONFIG } from '../src/core/config/defaults';
import { DEFAULT_ROLE_CONFIG } from '../src/role/default-role';
import { RoleConfigSchema } from '../src/role/role-schema';
import type { ChannelPlugin } from '../src/channel/channel-types';
import {
  AgentConfigSchema,
  AppConfigSchema,
  McpServerConfigSchema,
  PluginConfigEntrySchema,
  ProviderConfigSchema,
  ServerConfigSchema,
} from '../src/core/config/schema';
import type { PluginContext, PluginDefinition } from '../src/plugin/plugin-types';
import { PluginLoader } from '../src/plugin/plugin-loader';
import type {
  AppConfig,
  McpServerConfig,
  PluginConfigEntry,
  ProviderConfig,
} from '../src/core/config/schema';
import type { RoleConfig } from '../src/core/types';

type ConfigSection = keyof AppConfig;

interface ConfigEditorContext {
  root: string;
}

interface PromptController {
  choose<T>(title: string, options: ReadonlyArray<MenuOption<T>>, current?: T): Promise<T>;
  input(label: string, current?: string, options?: InputOptions): Promise<string>;
  message(message: string): void;
  stop(): void;
}

type Interface = PromptController;

interface MenuOption<T> {
  label: string;
  value: T;
}

interface InputOptions {
  secret?: boolean;
}

const INPUT_BACK_COMMAND = '/返回';

class BackRequested extends Error {
  constructor() {
    super('Input back requested');
  }
}

type SectionEditor = (
  ui: PromptController,
  config: AppConfig,
  context: ConfigEditorContext,
) => Promise<AppConfig>;

interface KnownConfigDefinition {
  name: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
}

type PromptRequest =
  | {
      kind: 'menu';
      title: string;
      options: ReadonlyArray<MenuOption<unknown>>;
      current?: unknown;
      resolve: (value: unknown) => void;
    }
  | {
      kind: 'input';
      label: string;
      current?: string;
      secret: boolean;
      resolve: (value: string) => void;
    };

interface TuiSnapshot {
  request: PromptRequest | null;
  messages: readonly string[];
  done: boolean;
}

const SECTION_DEFINITIONS: ReadonlyArray<{
  key: ConfigSection;
  label: string;
  editor: SectionEditor;
}> = [
  { key: 'server', label: '编辑服务配置', editor: editServer },
  { key: 'providers', label: '编辑模型服务商', editor: editProviders },
  { key: 'channels', label: '编辑频道', editor: editChannels },
  { key: 'agent', label: '编辑 Agent', editor: editAgent },
  { key: 'mcp', label: '编辑 MCP 服务', editor: editMcpServers },
  { key: 'plugins', label: '编辑插件', editor: editPlugins },
];

export function resolveConfigPath(root = process.cwd()): string {
  return resolveProjectPaths(root).configPath;
}

export function resolveExtensionsPath(root = process.cwd()): string {
  return resolveProjectPaths(root).extensionsDir;
}

function resolveProjectPaths(root = process.cwd()): {
  root: string;
  configPath: string;
  extensionsDir: string;
  rolesDir: string;
} {
  const resolver = new PathResolver();
  const resolvedRoot = normalizeProjectRoot(path.resolve(root));
  resolver.resolve(resolvedRoot);
  return {
    root: resolvedRoot,
    configPath: resolver.configFile,
    extensionsDir: resolver.extensionsDir,
    rolesDir: resolver.rolesDir,
  };
}

export function resolveRolesPath(root = process.cwd()): string {
  return resolveProjectPaths(root).rolesDir;
}

function normalizeProjectRoot(root: string): string {
  let current = root;
  while (true) {
    const extensionsDir = path.join(current, 'extensions');
    if (existsSync(extensionsDir) && statSync(extensionsDir).isDirectory()) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return root;
    }
    current = parent;
  }
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

export function validateRoleConfig(value: unknown): RoleConfig {
  const candidate = Value.Default(RoleConfigSchema, value);

  if (!Value.Check(RoleConfigSchema, candidate)) {
    const errors = [...Value.Errors(RoleConfigSchema, candidate)]
      .map((error) => `${error.path || '/'}: ${error.message}`)
      .join('\n');
    throw new Error(`角色配置校验失败：\n${errors}`);
  }

  return candidate as RoleConfig;
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

export interface RoleFileSummary {
  fileName: string;
  filePath: string;
  role?: RoleConfig;
}

export async function listRoleFiles(rolesDir: string): Promise<RoleFileSummary[]> {
  await mkdir(rolesDir, { recursive: true });
  const entries = await readdir(rolesDir, { withFileTypes: true });
  const summaries: RoleFileSummary[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const filePath = path.join(rolesDir, entry.name);
    let role: RoleConfig | undefined;
    try {
      role = validateRoleConfig(JSON.parse(await readFile(filePath, 'utf-8')) as unknown);
    } catch {
      role = undefined;
    }
    summaries.push({ fileName: entry.name, filePath, role });
  }

  return summaries.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

export async function saveRoleConfig(rolesDir: string, role: RoleConfig): Promise<string> {
  const validRole = validateRoleConfig(role);
  const filePath = path.join(rolesDir, roleFileNameForId(validRole.id));
  await mkdir(rolesDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(roleConfigForFile(validRole), null, 2)}\n`, 'utf-8');
  return filePath;
}

function roleConfigForFile(role: RoleConfig): RoleConfig | Record<string, unknown> {
  if (role.id !== DEFAULT_ROLE_CONFIG.id) {
    return role;
  }

  const serialized: Record<string, unknown> = { ...role };
  delete serialized.enabled;
  return serialized;
}

export async function removeRoleFile(rolesDir: string, fileName: string): Promise<void> {
  await unlink(resolveRoleFilePathForRemoval(rolesDir, fileName));
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

class InkPromptController implements PromptController {
  private readonly events = new EventEmitter();
  private snapshot: TuiSnapshot = { request: null, messages: [], done: false };

  subscribe(listener: () => void): () => void {
    this.events.on('change', listener);
    return () => {
      this.events.off('change', listener);
    };
  }

  getSnapshot(): TuiSnapshot {
    return this.snapshot;
  }

  choose<T>(title: string, options: ReadonlyArray<MenuOption<T>>, current?: T): Promise<T> {
    return new Promise<T>((resolve) => {
      this.update({
        request: {
          kind: 'menu',
          title,
          options: options as ReadonlyArray<MenuOption<unknown>>,
          current,
          resolve: (value) => resolve(value as T),
        },
      });
    });
  }

  input(label: string, current?: string, options: InputOptions = {}): Promise<string> {
    return new Promise<string>((resolve) => {
      this.update({
        request: {
          kind: 'input',
          label,
          current,
          secret: options.secret ?? false,
          resolve,
        },
      });
    });
  }

  message(message: string): void {
    this.update({ messages: [...this.snapshot.messages.slice(-7), message] });
  }

  stop(): void {
    this.update({ request: null, done: true });
  }

  private completeRequest(value: unknown): void {
    const request = this.snapshot.request;
    if (!request) return;

    this.update({ request: null });
    request.resolve(value as never);
  }

  selectMenuIndex(index: number): void {
    const request = this.snapshot.request;
    if (request?.kind !== 'menu') return;
    this.completeRequest(request.options[index]?.value);
  }

  submitInput(value: string): void {
    if (this.snapshot.request?.kind !== 'input') return;
    this.completeRequest(value);
  }

  private update(partial: Partial<TuiSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.events.emit('change');
  }
}

function ConfigEditorApp({ controller }: { controller: InkPromptController }): React.ReactElement {
  const [snapshot, setSnapshot] = useState(controller.getSnapshot());
  const { exit } = useApp();

  useEffect(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller]);
  useEffect(() => {
    if (snapshot.done) exit();
  }, [exit, snapshot.done]);

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Text, { bold: true, color: 'cyan' }, 'AesyClaw 配置编辑器'),
    snapshot.messages.length > 0
      ? React.createElement(
          Box,
          { flexDirection: 'column', marginY: 1 },
          snapshot.messages.map((message, index) =>
            React.createElement(Text, { key: `${index}-${message}`, color: 'gray' }, message),
          ),
        )
      : null,
    snapshot.request
      ? React.createElement(PromptView, { request: snapshot.request, controller })
      : React.createElement(Text, null, snapshot.done ? '已完成。' : '正在加载配置...'),
  );
}

function PromptView({
  request,
  controller,
}: {
  request: PromptRequest;
  controller: InkPromptController;
}): React.ReactElement {
  if (request.kind === 'menu') {
    return React.createElement(MenuPrompt, { request, controller });
  }

  return React.createElement(InputPrompt, { request, controller });
}

function MenuPrompt({
  request,
  controller,
}: {
  request: Extract<PromptRequest, { kind: 'menu' }>;
  controller: InkPromptController;
}): React.ReactElement {
  const currentIndex = Math.max(
    0,
    request.options.findIndex((option) => option.value === request.current),
  );
  const [selected, setSelected] = useState(currentIndex);

  useEffect(() => setSelected(currentIndex), [currentIndex, request]);
  useInput((input, key) => {
    if (key.upArrow) setSelected((value) => Math.max(0, value - 1));
    if (key.downArrow) setSelected((value) => Math.min(request.options.length - 1, value + 1));
    if (key.return) controller.selectMenuIndex(selected);

    const numeric = Number(input);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= request.options.length) {
      controller.selectMenuIndex(numeric - 1);
    }
  });

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Text, { bold: true }, request.title),
    ...request.options.map((option, index) => {
      const isSelected = index === selected;
      const suffix = option.value === request.current ? ' [当前]' : '';
      return React.createElement(
        Text,
        { key: `${index}-${option.label}`, color: isSelected ? 'green' : undefined },
        `${isSelected ? '›' : ' '} ${index + 1}. ${option.label}${suffix}`,
      );
    }),
    React.createElement(Text, { color: 'gray' }, '使用 ↑/↓ 和回车键，或按数字选择。'),
  );
}

function InputPrompt({
  request,
  controller,
}: {
  request: Extract<PromptRequest, { kind: 'input' }>;
  controller: InkPromptController;
}): React.ReactElement {
  const [draft, setDraft] = useState('');

  useEffect(() => setDraft(''), [request]);
  useInput((input, key) => {
    if (key.return) {
      controller.submitInput(draft.trim());
      return;
    }

    if (key.backspace || key.delete) {
      setDraft((value) => value.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setDraft((value) => `${value}${input}`);
    }
  });

  const suffix =
    request.current === undefined || request.current === '' ? '' : ` [${request.current}]`;
  const displayValue = request.secret ? '*'.repeat(draft.length) : draft;

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Text, null, `${request.label}${suffix}: ${displayValue}`),
    React.createElement(
      Text,
      { color: 'gray' },
      `按回车提交；输入 ${INPUT_BACK_COMMAND} 返回上一级。`,
    ),
  );
}

export async function runConfigEditor(
  configPath = resolveConfigPath(),
  root = process.cwd(),
): Promise<void> {
  const controller = new InkPromptController();
  const app = render(React.createElement(ConfigEditorApp, { controller }));

  try {
    let config = await loadConfig(configPath);
    let dirty = false;

    controller.message(`配置文件：${configPath}`);

    while (true) {
      const action = await choose(controller, '主菜单', [
        ...SECTION_DEFINITIONS.map((section) => ({ label: section.label, value: section.key })),
        { label: '编辑角色', value: 'roles' as const },
        { label: '预览配置', value: 'preview' as const },
        { label: '保存并退出', value: 'save' as const },
        { label: '不保存退出', value: 'exit' as const },
      ]);

      if (action === 'save') {
        await saveConfig(configPath, config);
        controller.message('配置已保存。');
        return;
      }

      if (action === 'exit') {
        if (!dirty || (await promptBoolean(controller, '放弃未保存的更改？', false))) {
          return;
        }
        continue;
      }

      if (action === 'preview') {
        controller.message(JSON.stringify(config, null, 2));
        continue;
      }

      if (action === 'roles') {
        await editRoles(controller, resolveRolesPath(root));
        continue;
      }

      try {
        config = await editSection(controller, action, config, { root: path.resolve(root) });
        dirty = true;
      } catch (error) {
        if (isBackRequested(error)) {
          controller.message('已返回上一级，未应用未完成的输入。');
          continue;
        }
        throw error;
      }
    }
  } finally {
    controller.stop();
    app.unmount();
  }
}

async function editSection(
  rl: Interface,
  section: ConfigSection,
  config: AppConfig,
  context: ConfigEditorContext,
): Promise<AppConfig> {
  const definition = SECTION_DEFINITIONS.find((candidate) => candidate.key === section);
  if (!definition) {
    throw new Error(`Unsupported config section: ${section}`);
  }

  return definition.editor(rl, config, context);
}

async function editServer(rl: Interface, config: AppConfig): Promise<AppConfig> {
  const server = config.server;
  return {
    ...config,
    server: (await editObjectBySchema(
      rl,
      ServerConfigSchema,
      server,
      '服务',
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

async function editProviders(rl: Interface, config: AppConfig): Promise<AppConfig> {
  let current = config;

  while (true) {
    const names = Object.keys(current.providers).sort();
    const action = await choose(rl, `模型服务商（${names.length}）`, [
      { label: '添加或更新服务商', value: 'upsert' as const },
      { label: '删除服务商', value: 'remove' as const },
      { label: '返回', value: 'back' as const },
    ]);

    if (action === 'back') return current;

    if (action === 'remove') {
      const name = await chooseName(rl, '选择要删除的服务商', names);
      if (name) current = removeProvider(current, name);
      continue;
    }

    const name = await promptString(rl, '服务商名称');
    const existing = current.providers[name];
    try {
      const provider = await editProvider(rl, existing);
      current = upsertProvider(current, name, provider);
    } catch (error) {
      if (isBackRequested(error)) {
        rl.message('已返回服务商菜单，未应用未完成的输入。');
        continue;
      }
      throw error;
    }
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
    '服务商',
  )) as ProviderConfig;
}

async function editChannels(
  rl: Interface,
  config: AppConfig,
  context: ConfigEditorContext,
): Promise<AppConfig> {
  let current = config;
  const knownChannels = await discoverKnownChannels(context.root);

  while (true) {
    const names = Object.keys(current.channels).sort();
    const action = await choose(rl, `频道（${names.length}）`, [
      { label: '添加或更新频道', value: 'upsert' as const },
      { label: '删除频道', value: 'remove' as const },
      { label: '返回', value: 'back' as const },
    ]);

    if (action === 'back') return current;

    if (action === 'remove') {
      const name = await chooseName(rl, '选择要删除的频道', names);
      if (name) current = removeChannel(current, name);
      continue;
    }

    const name = await chooseKnownOrCustomName(
      rl,
      '选择要添加或更新的频道',
      names,
      knownChannels,
      '手动输入频道名称',
    );
    const definition = knownChannels.find((candidate) => candidate.name === name);
    try {
      const channelConfig = await editKnownConfigObject(
        rl,
        '频道配置',
        current.channels[name],
        definition?.defaultConfig,
      );
      current = upsertChannel(current, name, channelConfig);
    } catch (error) {
      if (isBackRequested(error)) {
        rl.message('已返回频道菜单，未应用未完成的输入。');
        continue;
      }
      throw error;
    }
  }
}

async function editMcpServers(rl: Interface, config: AppConfig): Promise<AppConfig> {
  let current = config;

  while (true) {
    const names = current.mcp.map((server) => server.name).sort();
    const action = await choose(rl, `MCP 服务（${names.length}）`, [
      { label: '添加或更新 MCP 服务', value: 'upsert' as const },
      { label: '删除 MCP 服务', value: 'remove' as const },
      { label: '返回', value: 'back' as const },
    ]);

    if (action === 'back') return current;

    if (action === 'remove') {
      const name = await chooseName(rl, '选择要删除的 MCP 服务', names);
      if (name) current = removeMcpServer(current, name);
      continue;
    }

    const name = await promptString(rl, 'MCP 服务名称');
    const existing = current.mcp.find((server) => server.name === name);
    try {
      current = upsertMcpServer(current, await editMcpServer(rl, name, existing));
    } catch (error) {
      if (isBackRequested(error)) {
        rl.message('已返回 MCP 服务菜单，未应用未完成的输入。');
        continue;
      }
      throw error;
    }
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
    'MCP 服务',
    { skipKeys: ['name'] },
  );

  return { ...(edited as McpServerConfig), name };
}

async function editPlugins(
  rl: Interface,
  config: AppConfig,
  context: ConfigEditorContext,
): Promise<AppConfig> {
  let current = config;
  const knownPlugins = await discoverKnownPlugins(context.root);

  while (true) {
    const names = current.plugins.map((plugin) => plugin.name).sort();
    const action = await choose(rl, `插件（${names.length}）`, [
      { label: '添加或更新插件', value: 'upsert' as const },
      { label: '删除插件', value: 'remove' as const },
      { label: '返回', value: 'back' as const },
    ]);

    if (action === 'back') return current;

    if (action === 'remove') {
      const name = await chooseName(rl, '选择要删除的插件', names);
      if (name) current = removePlugin(current, name);
      continue;
    }

    const name = await chooseKnownOrCustomName(
      rl,
      '选择要添加或更新的插件',
      names,
      knownPlugins,
      '手动输入插件名称',
    );
    const existing = current.plugins.find((plugin) => plugin.name === name);
    const definition = knownPlugins.find((candidate) => candidate.name === name);
    try {
      const plugin = await editPlugin(rl, name, existing, definition?.defaultConfig);
      current = upsertPlugin(current, plugin);
    } catch (error) {
      if (isBackRequested(error)) {
        rl.message('已返回插件菜单，未应用未完成的输入。');
        continue;
      }
      throw error;
    }
  }
}

async function editPlugin(
  rl: Interface,
  name: string,
  existing?: Readonly<PluginConfigEntry>,
  defaultOptions?: Record<string, unknown>,
): Promise<PluginConfigEntry> {
  const edited = await editObjectBySchema(
    rl,
    PluginConfigEntrySchema,
    { ...(existing ?? {}), name },
    '插件',
    { skipKeys: ['name', 'options'] },
  );

  const plugin = { ...(edited as PluginConfigEntry), name };
  const options = await editKnownConfigObject(rl, '插件选项', existing?.options, defaultOptions);
  if (Object.keys(options).length > 0) {
    plugin.options = options;
  }
  return plugin;
}

async function editRoles(rl: Interface, rolesDir: string): Promise<void> {
  while (true) {
    const roles = await listRoleFiles(rolesDir);
    const action = await choose(rl, `角色（${roles.length}）`, [
      { label: '查看角色文件', value: 'list' as const },
      { label: '添加或更新角色', value: 'upsert' as const },
      { label: '删除角色', value: 'remove' as const },
      { label: '返回', value: 'back' as const },
    ]);

    if (action === 'back') return;

    if (action === 'list') {
      rl.message(formatRoleList(roles, rolesDir));
      continue;
    }

    if (action === 'remove') {
      const role = await chooseRoleFile(rl, '选择要删除的角色', roles);
      if (role) {
        await removeRoleFile(rolesDir, role.fileName);
        rl.message(`已删除角色文件：${role.fileName}`);
      }
      continue;
    }

    try {
      const target = await chooseRoleForUpsert(rl, roles);
      const template = target?.role ?? createRoleTemplate(await promptString(rl, '角色 ID'));
      const edited = await editRoleConfig(rl, template);
      const filePath = await saveRoleConfig(rolesDir, edited);
      rl.message(`角色已保存：${filePath}`);
    } catch (error) {
      if (isBackRequested(error)) {
        rl.message('已返回角色菜单，未写入未完成的角色。');
        continue;
      }
      throw error;
    }
  }
}

async function chooseRoleForUpsert(
  rl: Interface,
  roles: readonly RoleFileSummary[],
): Promise<RoleFileSummary | null> {
  const createValue = Symbol('create-role');
  const selected = await choose<RoleFileSummary | typeof createValue>(
    rl,
    '选择要添加或更新的角色',
    [
      ...roles.map((role) => ({ label: formatRoleOption(role), value: role })),
      { label: '新建角色', value: createValue },
    ],
  );

  return selected === createValue ? null : selected;
}

async function chooseRoleFile(
  rl: Interface,
  label: string,
  roles: readonly RoleFileSummary[],
): Promise<RoleFileSummary | null> {
  if (roles.length === 0) {
    rl.message('没有可操作的角色文件。');
    return null;
  }

  return choose(
    rl,
    label,
    roles.map((role) => ({ label: formatRoleOption(role), value: role })),
  );
}

async function editRoleConfig(rl: Interface, template: RoleConfig): Promise<RoleConfig> {
  const edited = await editObjectBySchema(
    rl,
    RoleConfigSchema,
    structuredClone(template) as unknown as Record<string, unknown>,
    '角色',
  );
  return validateRoleConfig(edited);
}

function createRoleTemplate(id: string): RoleConfig {
  return {
    ...structuredClone(DEFAULT_ROLE_CONFIG),
    id,
    name: id === DEFAULT_ROLE_CONFIG.id ? DEFAULT_ROLE_CONFIG.name : id,
    enabled: true,
  };
}

function formatRoleList(roles: readonly RoleFileSummary[], rolesDir: string): string {
  if (roles.length === 0) {
    return `角色目录 ${rolesDir} 中没有 JSON 角色文件。`;
  }

  const lines = roles.map((role) => `- ${formatRoleOption(role)}`);
  return `角色目录：${rolesDir}\n${lines.join('\n')}`;
}

function formatRoleOption(role: RoleFileSummary): string {
  if (!role.role) {
    return `${role.fileName}（无效 JSON 或验证失败）`;
  }

  return `${role.role.id} — ${role.role.name}（${role.fileName}）`;
}

function roleFileNameForId(id: string): string {
  return `${id.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'role'}.json`;
}

function resolveRoleFilePathForRemoval(rolesDir: string, fileName: string): string {
  if (fileName !== path.basename(fileName) || !fileName.endsWith('.json')) {
    throw new Error('Invalid role file name.');
  }

  const resolvedRolesDir = path.resolve(rolesDir);
  const resolvedFilePath = path.resolve(resolvedRolesDir, fileName);
  const relative = path.relative(resolvedRolesDir, resolvedFilePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Role file must be inside the roles directory.');
  }

  return resolvedFilePath;
}

export async function chooseKnownOrCustomName(
  rl: Interface,
  label: string,
  configuredNames: readonly string[],
  knownDefinitions: readonly KnownConfigDefinition[],
  customLabel: string,
): Promise<string> {
  const customValue = Symbol('custom-config-name');
  const seen = new Set<string>();
  const options: Array<MenuOption<string | typeof customValue>> = [];

  for (const name of configuredNames) {
    seen.add(name);
    options.push({ label: `已配置：${name}`, value: name });
  }

  for (const definition of knownDefinitions) {
    if (seen.has(definition.name)) {
      continue;
    }
    const suffix = definition.description ? ` — ${definition.description}` : '';
    options.push({ label: `已知：${definition.name}${suffix}`, value: definition.name });
  }

  options.push({ label: customLabel, value: customValue });
  const selected = await choose(rl, label, options);
  return selected === customValue ? promptString(rl, customLabel) : selected;
}

export async function editKnownConfigObject(
  rl: Interface,
  label: string,
  existing: unknown,
  defaultConfig?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const existingConfig = isRecord(existing) ? existing : {};
  const defaultTemplate = defaultConfig ?? {};
  const hasTemplate =
    Object.keys(defaultTemplate).length > 0 || Object.keys(existingConfig).length > 0;

  if (!hasTemplate) {
    return promptJsonObject(rl, `${label} JSON 对象`, existingConfig);
  }

  const action = await choose(rl, label, [
    { label: '按字段编辑默认值和已有键', value: 'fields' as const },
    { label: '编辑原始 JSON 对象', value: 'json' as const },
  ]);

  if (action === 'json') {
    return promptJsonObject(rl, `${label} JSON 对象`, { ...defaultTemplate, ...existingConfig });
  }

  return editObjectByTemplate(rl, defaultTemplate, existingConfig, label);
}

async function editObjectByTemplate(
  rl: Interface,
  defaults: Record<string, unknown>,
  existing: Record<string, unknown>,
  labelPrefix: string,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  const keys = mergeTemplateKeys(defaults, existing);

  for (const key of keys) {
    const fallback = key in existing ? existing[key] : defaults[key];
    const label = `${labelPrefix} ${humanizeKey(key)}`.trim();
    const value = await editTemplateValue(rl, label, fallback);
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return stripUndefined(result);
}

async function editTemplateValue(rl: Interface, label: string, current: unknown): Promise<unknown> {
  if (typeof current === 'string') {
    return isSecretLabel(label)
      ? promptSecretLikeString(rl, label, current)
      : promptOptionalString(rl, label, current);
  }

  if (typeof current === 'number') {
    return promptOptionalNumber(rl, label, current);
  }

  if (typeof current === 'boolean') {
    return promptOptionalBoolean(rl, label, current);
  }

  if (Array.isArray(current)) {
    return promptJsonArray(rl, `${label} JSON 数组`, current);
  }

  if (isRecord(current)) {
    return promptJsonObject(rl, `${label} JSON 对象`, current);
  }

  return promptJsonValue(rl, `${label} JSON 值`, current);
}

export function mergeTemplateKeys(
  defaults: Record<string, unknown>,
  existing: Record<string, unknown>,
): string[] {
  const keys = Object.keys(defaults);
  const seen = new Set(keys);
  for (const key of Object.keys(existing).sort()) {
    if (!seen.has(key)) {
      keys.push(key);
    }
  }
  return keys;
}

export async function discoverKnownPlugins(root = process.cwd()): Promise<KnownConfigDefinition[]> {
  const modules = await discoverPluginModules(root);
  return modules.map(({ definition, directoryName }) => ({
    name: definition.name,
    description: definition.description ?? directoryName,
    defaultConfig: definition.defaultConfig,
  }));
}

export async function discoverKnownChannels(
  root = process.cwd(),
): Promise<KnownConfigDefinition[]> {
  const channels = new Map<string, KnownConfigDefinition>();
  const modules = await discoverPluginModules(root);

  for (const { definition } of modules) {
    for (const channel of await discoverPluginChannels(definition)) {
      channels.set(channel.name, {
        name: channel.name,
        description: channel.description,
        defaultConfig: channel.defaultConfig,
      });
    }
  }

  return [...channels.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function discoverPluginModules(
  root: string,
): Promise<Array<{ definition: PluginDefinition; directoryName: string }>> {
  const { extensionsDir } = resolveProjectPaths(root);
  const loader = new PluginLoader({ extensionsDir });
  const modules: Array<{ definition: PluginDefinition; directoryName: string }> = [];

  for (const pluginDir of await loader.discover()) {
    try {
      const module = await loader.load(pluginDir);
      modules.push({ definition: module.definition, directoryName: module.directoryName });
    } catch {
      // Ignore unloadable extensions; manual custom entries remain available.
    }
  }

  return modules.sort((a, b) => a.definition.name.localeCompare(b.definition.name));
}

async function discoverPluginChannels(definition: PluginDefinition): Promise<ChannelPlugin[]> {
  const channels: ChannelPlugin[] = [];
  const context: PluginContext = {
    config: definition.defaultConfig ?? {},
    registerTool: () => undefined,
    unregisterTool: () => undefined,
    registerCommand: () => undefined,
    registerChannel: (channel) => {
      channels.push(channel);
    },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };

  try {
    await definition.init(context);
  } catch {
    return [];
  }

  return channels;
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

    return promptJsonObject(rl, `${label} JSON 对象`, currentObject);
  }

  if (schema.type === 'array') {
    if (isStringArraySchema(schema)) {
      return promptStringArray(
        rl,
        label,
        Array.isArray(current) ? stringifyArray(current) : undefined,
      );
    }

    return promptJsonArray(rl, `${label} JSON 数组`, Array.isArray(current) ? current : undefined);
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

  return promptJsonValue(rl, `${label} JSON 值`, current);
}

async function editRecordBySchema(
  rl: Interface,
  label: string,
  current: Record<string, unknown>,
  schema: TSchema,
): Promise<Record<string, unknown> | undefined> {
  const valueSchema = getRecordValueSchema(schema);
  if (!valueSchema) {
    return promptJsonObject(rl, `${label} JSON 对象`, current);
  }

  const entries = structuredClone(current);

  while (true) {
    const names = Object.keys(entries).sort();
    const action = await choose(rl, `${label}（${names.length}）`, [
      { label: `添加或更新${label}条目`, value: 'upsert' as const },
      { label: `删除${label}条目`, value: 'remove' as const },
      { label: '返回', value: 'back' as const },
    ]);

    if (action === 'back') {
      return Object.keys(entries).length > 0 ? entries : undefined;
    }

    if (action === 'remove') {
      const name = await chooseName(rl, `选择要删除的${label}条目`, names);
      if (name) {
        delete entries[name];
      }
      continue;
    }

    const name = await promptString(rl, `${label}条目名称`);
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
  const dictionary: Record<string, string> = {
    enabled: '启用',
    serverUrl: '服务地址',
    accessToken: '访问令牌',
    apiKey: 'API 密钥',
    apiType: 'API 类型',
    baseUrl: '基础地址',
    realModelName: '真实模型名称',
    contextWindow: '上下文窗口',
    enableThinking: '启用思考',
    extraBody: '额外请求体',
    host: '主机',
    port: '端口',
    cors: '跨域',
    logLevel: '日志级别',
    compressionThreshold: '压缩阈值',
    speechToText: '语音转文字',
    imageUnderstanding: '图片理解',
    provider: '服务商',
    model: '模型',
    memory: '记忆',
    multimodal: '多模态',
    transport: '传输方式',
    command: '命令',
    args: '参数',
    env: '环境变量',
    url: '地址',
  };

  return (
    dictionary[key] ??
    key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/^./, (value) => value.toUpperCase())
  );
}

function isSecretLabel(label: string): boolean {
  return /(api key|token|secret|password|密钥|令牌|密码|secret)/i.test(label);
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
  return rl.choose(title, options);
}

async function chooseWithDefault<T>(
  rl: Interface,
  title: string,
  options: ReadonlyArray<{ label: string; value: T }>,
  current?: T,
): Promise<T> {
  return rl.choose(title, options, current);
}

async function chooseName(
  rl: Interface,
  label: string,
  names: readonly string[],
): Promise<string | null> {
  if (names.length === 0) {
    rl.message('没有可删除的条目。');
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
    rl.message('必填项不能为空。');
  }
}

async function promptOptionalString(
  rl: Interface,
  label: string,
  current?: string,
): Promise<string | undefined> {
  const raw = await promptRaw(rl, `${label}（留空保留，输入 - 清除）`, current);
  if (raw === '') return current;
  if (raw === '-') return undefined;
  return raw;
}

async function promptSecretLikeString(
  rl: Interface,
  label: string,
  current?: string,
): Promise<string | undefined> {
  const suffix = current ? '（当前已设置；留空保留，输入 - 清除）' : '（留空跳过）';
  const raw = await rl.input(`${label}${suffix}（输入 ${INPUT_BACK_COMMAND} 返回）`, undefined, {
    secret: true,
  });
  if (raw === INPUT_BACK_COMMAND) {
    throw new BackRequested();
  }
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
    rl.message('必填项不能为空。');
  }
}

async function promptNumber(rl: Interface, label: string, current: number): Promise<number> {
  while (true) {
    const raw = await promptRaw(rl, label, String(current));
    if (raw === '') return current;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
    rl.message('请输入有效数字。');
  }
}

async function promptOptionalNumber(
  rl: Interface,
  label: string,
  current?: number,
): Promise<number | undefined> {
  while (true) {
    const raw = await promptRaw(rl, `${label}（留空保留，输入 - 清除）`, formatCurrent(current));
    if (raw === '') return current;
    if (raw === '-') return undefined;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
    rl.message('请输入有效数字。');
  }
}

async function promptBoolean(rl: Interface, label: string, current: boolean): Promise<boolean> {
  while (true) {
    const raw = await promptRaw(rl, `${label}（y/n）`, current ? 'y' : 'n');
    if (raw === '') return current;
    const normalized = raw.toLowerCase();
    if (['y', 'yes', 'true', '1'].includes(normalized)) return true;
    if (['n', 'no', 'false', '0'].includes(normalized)) return false;
    rl.message('请输入 y 或 n。');
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
      `${label}（y/n，留空保留，输入 - 清除）`,
      current === undefined ? undefined : current ? 'y' : 'n',
    );
    if (raw === '') return current;
    if (raw === '-') return undefined;
    const normalized = raw.toLowerCase();
    if (['y', 'yes', 'true', '1'].includes(normalized)) return true;
    if (['n', 'no', 'false', '0'].includes(normalized)) return false;
    rl.message('请输入 y、n 或 -。');
  }
}

async function promptStringArray(
  rl: Interface,
  label: string,
  current?: readonly string[],
): Promise<string[] | undefined> {
  const raw = await promptRaw(
    rl,
    `${label}（用英文逗号分隔，留空保留，输入 - 清除）`,
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
    rl.message(`当前${label}：${JSON.stringify(currentObject)}`);
    const raw = await promptRaw(rl, `${label}（留空保留，输入 - 清除）`, undefined);
    if (raw === '') return { ...currentObject };
    if (raw === '-') return {};

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isRecord(parsed)) return parsed;
      rl.message('请输入 JSON 对象，例如：{"enabled":true}');
    } catch (error) {
      rl.message(`JSON 无效：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function promptJsonArray(
  rl: Interface,
  label: string,
  current?: readonly unknown[],
): Promise<unknown[] | undefined> {
  while (true) {
    rl.message(`当前${label}：${JSON.stringify(current ?? [])}`);
    const raw = await promptRaw(rl, `${label}（留空保留，输入 - 清除）`, undefined);
    if (raw === '') return current ? [...current] : undefined;
    if (raw === '-') return undefined;

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed;
      rl.message('请输入 JSON 数组，例如：["value"]');
    } catch (error) {
      rl.message(`JSON 无效：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function promptJsonValue(rl: Interface, label: string, current?: unknown): Promise<unknown> {
  while (true) {
    rl.message(`当前${label}：${JSON.stringify(current)}`);
    const raw = await promptRaw(rl, `${label}（留空保留，输入 - 清除）`, undefined);
    if (raw === '') return current;
    if (raw === '-') return undefined;

    try {
      return JSON.parse(raw) as unknown;
    } catch (error) {
      rl.message(`JSON 无效：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function promptRaw(rl: Interface, label: string, current?: string): Promise<string> {
  const raw = await rl.input(`${label}（输入 ${INPUT_BACK_COMMAND} 返回）`, current);
  if (raw === INPUT_BACK_COMMAND) {
    throw new BackRequested();
  }
  return raw;
}

function isBackRequested(error: unknown): error is BackRequested {
  return error instanceof BackRequested;
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

function parseConfigPathArg(argv: readonly string[]): { configPath: string; root: string } {
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

  const paths = resolveProjectPaths(root);
  return { configPath: path.resolve(configPath ?? paths.configPath), root: paths.root };
}

function printHelp(): void {
  writeLine('用法：yarn config:edit [--root <路径>] [--config <路径>]');
  writeLine('');
  writeLine('选项：');
  writeLine('  --root <路径>    用于解析 .aesyclaw/config.json 的项目根目录');
  writeLine('  --config <路径>  显式指定配置文件路径');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = parseConfigPathArg(process.argv.slice(2));
  runConfigEditor(args.configPath, args.root).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
