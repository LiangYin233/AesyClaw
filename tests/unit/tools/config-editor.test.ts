import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/core/config/defaults';
import {
  loadConfig,
  removeChannel,
  removeMcpServer,
  removePlugin,
  removeProvider,
  resolveConfigPath,
  saveConfig,
  upsertChannel,
  upsertMcpServer,
  upsertPlugin,
  upsertProvider,
  validateConfig,
} from '../../../tools/config-editor';

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
    const config = { ...DEFAULT_CONFIG, agent: { maxSteps: 25 } };

    await saveConfig(configPath, config);

    const raw = await readFile(configPath, 'utf-8');
    expect(raw).toContain('  "maxSteps": 25');
    expect(validateConfig(JSON.parse(raw) as unknown).agent.maxSteps).toBe(25);
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
});
