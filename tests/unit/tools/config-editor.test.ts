import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/core/config/defaults';
import {
  chooseKnownOrCustomName,
  discoverKnownChannels,
  discoverKnownPlugins,
  editKnownConfigObject,
  loadConfig,
  listRoleFiles,
  mergeTemplateKeys,
  removeChannel,
  removeMcpServer,
  removePlugin,
  removeProvider,
  removeRoleFile,
  resolveConfigPath,
  resolveExtensionsPath,
  resolveRolesPath,
  saveConfig,
  saveRoleConfig,
  upsertChannel,
  upsertMcpServer,
  upsertPlugin,
  upsertProvider,
  validateConfig,
  validateRoleConfig,
} from '../../../tools/config-editor';

interface TestMenuOption<T> {
  label: string;
  value: T;
}

class TestPromptController {
  readonly menuTitles: string[] = [];
  readonly inputLabels: string[] = [];

  constructor(
    private readonly menuSelections: number[] = [],
    private readonly inputValues: string[] = [],
  ) {}

  async choose<T>(title: string, options: ReadonlyArray<TestMenuOption<T>>): Promise<T> {
    this.menuTitles.push(title);
    const index = this.menuSelections.shift() ?? 0;
    const option = options[index];
    if (!option) {
      throw new Error(`Missing test menu option at index ${index}`);
    }
    return option.value;
  }

  async input(label: string): Promise<string> {
    this.inputLabels.push(label);
    return this.inputValues.shift() ?? '';
  }

  message(): void {
    // Test prompt messages are intentionally ignored.
  }

  stop(): void {
    // No-op for helper tests.
  }
}

describe('config editor tool helpers', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function createTempDir(): Promise<string> {
    tempDir = await mkdtemp(path.join(tmpdir(), 'aesyclaw-config-editor-'));
    return tempDir;
  }

  it('resolves the runtime config path from a project root', async () => {
    const root = await createTempDir();

    expect(resolveConfigPath(root)).toBe(path.join(root, '.aesyclaw', 'config.json'));
  });

  it('resolves extensions path from the repository root', () => {
    expect(resolveExtensionsPath(process.cwd())).toBe(path.join(process.cwd(), 'extensions'));
  });

  it('resolves roles path from a project root', async () => {
    const root = await createTempDir();

    expect(resolveRolesPath(root)).toBe(path.join(root, '.aesyclaw', 'roles'));
  });

  it('creates a default config file when the target is missing', async () => {
    const root = await createTempDir();
    const configPath = resolveConfigPath(root);

    const config = await loadConfig(configPath);
    const fileContent = JSON.parse(await readFile(configPath, 'utf-8')) as unknown;

    expect(config).toEqual(DEFAULT_CONFIG);
    expect(validateConfig(fileContent)).toEqual(DEFAULT_CONFIG);
  });

  it('validates config before saving formatted JSON', async () => {
    const root = await createTempDir();
    const configPath = resolveConfigPath(root);
    const config = { ...DEFAULT_CONFIG, agent: { ...DEFAULT_CONFIG.agent, memory: { compressionThreshold: 0.5 } } };

    await saveConfig(configPath, config);

    const raw = await readFile(configPath, 'utf-8');
    expect(raw).toContain('"compressionThreshold"');
    expect(validateConfig(JSON.parse(raw) as unknown).agent.memory.compressionThreshold).toBe(0.5);
  });

  it('rejects explicitly invalid config instead of casting it', () => {
    expect(() =>
      validateConfig({
        ...structuredClone(DEFAULT_CONFIG),
        server: { ...DEFAULT_CONFIG.server, port: '3000' },
      }),
    ).toThrow('Config validation failed');
  });

  it('still fills defaults for missing optional fields', () => {
    const config = validateConfig({
      ...structuredClone(DEFAULT_CONFIG),
      server: { port: 3000, host: '0.0.0.0', logLevel: 'info' },
      mcp: [{ name: 'filesystem', transport: 'stdio' }],
      plugins: [{ name: 'plugin_example' }],
    });

    expect(config.server.cors).toBe(true);
    expect(config.mcp[0]?.enabled).toBe(true);
    expect(config.plugins[0]?.enabled).toBe(true);
  });

  it('upserts and removes full-form collection sections', () => {
    let config = structuredClone(DEFAULT_CONFIG);

    config = upsertProvider(config, 'openai', {
      apiType: 'openai_responses',
      models: {
        gpt: {
          realModelName: 'gpt-4o',
          contextWindow: 128000,
          enableThinking: false,
        },
      },
    });
    config = upsertChannel(config, 'console', { enabled: true });
    config = upsertMcpServer(config, {
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      enabled: true,
    });
    config = upsertPlugin(config, {
      name: 'plugin_example',
      enabled: true,
      options: { greeting: 'hello' },
    });

    expect(config.providers.openai?.models?.gpt?.realModelName).toBe('gpt-4o');
    expect(config.channels.console).toEqual({ enabled: true });
    expect(config.mcp).toHaveLength(1);
    expect(config.plugins).toHaveLength(1);

    config = removeProvider(config, 'openai');
    config = removeChannel(config, 'console');
    config = removeMcpServer(config, 'filesystem');
    config = removePlugin(config, 'plugin_example');

    expect(config.providers.openai).toBeUndefined();
    expect(config.channels.console).toBeUndefined();
    expect(config.mcp).toEqual([]);
    expect(config.plugins).toEqual([]);
  });

  it('discovers known plugin definitions for selectable editor defaults', async () => {
    const root = await createTempDir();
    await writePluginFixture(root, 'plugin_alpha', {
      body: "name: 'alpha', version: '1.0.0', defaultConfig: { greeting: 'hello' }, async init() {}",
    });

    const plugins = await discoverKnownPlugins(root);

    expect(plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'alpha',
          defaultConfig: { greeting: 'hello' },
        }),
      ]),
    );
  });

  it('discovers known channel definitions registered by plugins', async () => {
    const root = await createTempDir();
    await writePluginFixture(root, 'plugin_channel_alpha', {
      body: `name: 'channel-alpha-plugin',
        version: '1.0.0',
        async init(ctx) {
          ctx.registerChannel({
            name: 'channel-alpha',
            version: '1.0.0',
            description: 'Alpha channel',
            defaultConfig: { enabled: false, endpoint: 'ws://localhost' },
            async init() {}
          });
        }`,
    });

    const channels = await discoverKnownChannels(root);

    expect(channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'channel-alpha',
          description: 'Alpha channel',
          defaultConfig: {
            enabled: false,
            endpoint: 'ws://localhost',
          },
        }),
      ]),
    );
  });

  it('keeps custom name entry available even when known definitions are selectable', async () => {
    const prompt = new TestPromptController([2], ['custom-plugin']);

    const name = await chooseKnownOrCustomName(
      prompt,
      '选择要添加或更新的插件',
      ['configured-plugin'],
      [{ name: 'known-plugin', defaultConfig: { enabled: true } }],
      '手动输入插件名称',
    );

    expect(name).toBe('custom-plugin');
    expect(prompt.inputLabels).toEqual(['手动输入插件名称（输入 /返回 返回）']);
  });

  it('builds guided config fields from defaults followed by existing-only keys', async () => {
    expect(
      mergeTemplateKeys(
        { enabled: true, serverUrl: 'ws://localhost' },
        { customKey: 1, enabled: false },
      ),
    ).toEqual(['enabled', 'serverUrl', 'customKey']);
  });

  it('edits guided config using defaultConfig plus existing configured keys', async () => {
    const prompt = new TestPromptController([0], ['', 'ws://remote', '42']);

    const config = await editKnownConfigObject(
      prompt,
      '频道配置',
      { customKey: 7 },
      { enabled: true, serverUrl: 'ws://localhost' },
    );

    expect(config).toEqual({ enabled: true, serverUrl: 'ws://remote', customKey: 42 });
    expect(prompt.inputLabels).toEqual([
      '频道配置 启用（y/n，留空保留，输入 - 清除）（输入 /返回 返回）',
      '频道配置 服务地址（留空保留，输入 - 清除）（输入 /返回 返回）',
      '频道配置 Custom Key（留空保留，输入 - 清除）（输入 /返回 返回）',
    ]);
  });

  it('uses Chinese labels for known/custom selection menus', async () => {
    const prompt = new TestPromptController([1]);

    const name = await chooseKnownOrCustomName(
      prompt,
      '选择要添加或更新的频道',
      ['configured-channel'],
      [{ name: 'known-channel', description: 'Known channel', defaultConfig: { enabled: true } }],
      '手动输入频道名称',
    );

    expect(name).toBe('known-channel');
    expect(prompt.menuTitles).toEqual(['选择要添加或更新的频道']);
  });

  it('throws without applying partial field edits when input backs out', async () => {
    const prompt = new TestPromptController([0], ['false', '/返回']);

    await expect(
      editKnownConfigObject(
        prompt,
        '频道配置',
        { enabled: true, serverUrl: 'ws://original' },
        { enabled: true, serverUrl: 'ws://localhost' },
      ),
    ).rejects.toThrow('Input back requested');
    expect(prompt.inputLabels).toEqual([
      '频道配置 启用（y/n，留空保留，输入 - 清除）（输入 /返回 返回）',
      '频道配置 服务地址（留空保留，输入 - 清除）（输入 /返回 返回）',
    ]);
  });

  it('uses guided editing for existing custom config without a known default template', async () => {
    const prompt = new TestPromptController([0], ['updated']);

    const config = await editKnownConfigObject(prompt, '插件选项', { customGreeting: 'hello' });

    expect(config).toEqual({ customGreeting: 'updated' });
  });

  it('continues discovery when one extension fails to load', async () => {
    const root = await createTempDir();
    const extensionsDir = path.join(root, 'extensions');
    await mkdir(path.join(extensionsDir, 'plugin_bad'), { recursive: true });
    await writeFile(
      path.join(extensionsDir, 'plugin_bad', 'index.ts'),
      'throw new Error("boom");\n',
    );
    await mkdir(path.join(extensionsDir, 'plugin_good'), { recursive: true });
    await writeFile(
      path.join(extensionsDir, 'plugin_good', 'index.ts'),
      `import type { PluginDefinition } from '${path.join(process.cwd(), 'src', 'plugin', 'plugin-types').replace(/\\/g, '/')}';
      const plugin: PluginDefinition = {
        name: 'good',
        version: '0.1.0',
        defaultConfig: { greeting: 'hi' },
        async init() {}
      };
      export default plugin;
      `,
    );

    await expect(discoverKnownPlugins(root)).resolves.toEqual([]);
  });

  it('validates and saves role configs as formatted role JSON files', async () => {
    const root = await createTempDir();
    const rolesDir = resolveRolesPath(root);

    const filePath = await saveRoleConfig(rolesDir, {
      id: 'assistant/general',
      name: '通用助手',
      description: '测试角色',
      systemPrompt: 'You are helpful.',
      model: 'openai/gpt-4o',
      toolPermission: { mode: 'allowlist', list: ['*'] },
      skills: ['*'],
      enabled: true,
    });

    expect(filePath).toBe(path.join(rolesDir, 'assistant_general.json'));
    const raw = await readFile(filePath, 'utf-8');
    expect(raw).toContain('  "name": "通用助手"');
    expect(validateRoleConfig(JSON.parse(raw) as unknown).id).toBe('assistant/general');
  });

  it('lists valid and invalid role JSON files from the roles directory', async () => {
    const root = await createTempDir();
    const rolesDir = resolveRolesPath(root);
    await mkdir(rolesDir, { recursive: true });
    await saveRoleConfig(rolesDir, {
      id: 'default',
      name: 'Default Assistant',
      description: 'Valid role',
      systemPrompt: 'Prompt',
      model: 'openai/gpt-4o',
      toolPermission: { mode: 'allowlist', list: ['*'] },
      skills: ['*'],
      enabled: true,
    });
    await writeFile(path.join(rolesDir, 'broken.json'), '{"id":123}', 'utf-8');

    const roles = await listRoleFiles(rolesDir);

    expect(roles.map((role) => role.fileName)).toEqual(['broken.json', 'default.json']);
    expect(roles.find((role) => role.fileName === 'default.json')?.role?.id).toBe('default');
    expect(
      JSON.parse(await readFile(path.join(rolesDir, 'default.json'), 'utf-8')),
    ).not.toHaveProperty('enabled');
    expect(roles.find((role) => role.fileName === 'broken.json')?.role).toBeUndefined();
  });

  it('removes a selected role file helper target', async () => {
    const root = await createTempDir();
    const rolesDir = resolveRolesPath(root);
    const filePath = await saveRoleConfig(rolesDir, {
      id: 'temporary',
      name: 'Temporary',
      description: 'Temporary role',
      systemPrompt: 'Prompt',
      model: 'openai/gpt-4o',
      toolPermission: { mode: 'denylist', list: [] },
      skills: [],
      enabled: true,
    });

    await removeRoleFile(rolesDir, path.basename(filePath));

    expect(await listRoleFiles(rolesDir)).toEqual([]);
  });

  it('rejects role removal paths outside the roles directory', async () => {
    const root = await createTempDir();
    const rolesDir = resolveRolesPath(root);
    await mkdir(rolesDir, { recursive: true });

    await expect(removeRoleFile(rolesDir, '../config.json')).rejects.toThrow(
      'Invalid role file name',
    );
    await expect(removeRoleFile(rolesDir, 'nested/role.json')).rejects.toThrow(
      'Invalid role file name',
    );
    await expect(removeRoleFile(rolesDir, 'not-json.txt')).rejects.toThrow(
      'Invalid role file name',
    );
  });
});

async function writePluginFixture(
  root: string,
  directoryName: string,
  options: { body: string },
): Promise<void> {
  const pluginDir = path.join(root, 'extensions', directoryName);
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    path.join(pluginDir, 'index.js'),
    `export default { ${options.body} };\n`,
    'utf-8',
  );
}
