import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PluginLoader } from '../../../src/plugin/plugin-loader';

async function makeExtensionDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'aesyclaw-plugin-loader-'));
}

describe('PluginLoader', () => {
  it('discovers plugin_* directories only', async () => {
    const extensionDir = await makeExtensionDir();
    await mkdir(path.join(extensionDir, 'plugin_alpha'));
    await mkdir(path.join(extensionDir, 'not_a_plugin'));

    const loader = new PluginLoader({ extensionDir });
    const discovered = await loader.discover();

    expect(discovered).toEqual([path.join(extensionDir, 'plugin_alpha')]);
  });

  it('loads a valid plugin definition through dynamic import', async () => {
    const extensionDir = await makeExtensionDir();
    const pluginDir = path.join(extensionDir, 'plugin_alpha');
    await mkdir(pluginDir);
    await writeFile(
      path.join(pluginDir, 'index.js'),
      "export default { name: 'alpha', version: '1.0.0', async init() {} };\n",
      'utf-8',
    );

    const loader = new PluginLoader({ extensionDir });
    const loaded = await loader.load(pluginDir);

    expect(loaded.definition.name).toBe('alpha');
    expect(loaded.directoryName).toBe('plugin_alpha');
    expect(loaded.entryPath).toBe(path.join(pluginDir, 'index.js'));
  });

  it('rejects modules without a PluginDefinition export', async () => {
    const extensionDir = await makeExtensionDir();
    const pluginDir = path.join(extensionDir, 'plugin_bad');
    await mkdir(pluginDir);
    await writeFile(path.join(pluginDir, 'index.js'), 'export default { name: 123 };\n', 'utf-8');

    const loader = new PluginLoader({ extensionDir });

    await expect(loader.load(pluginDir)).rejects.toThrow(/valid PluginDefinition/);
  });
});
