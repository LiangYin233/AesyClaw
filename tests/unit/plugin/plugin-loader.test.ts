import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PluginLoader } from '../../../src/extension/plugin/plugin-loader';

async function makeExtensionsDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), 'aesyclaw-plugin-loader-'));
}

describe('PluginLoader', () => {
  it('discovers plugin_* directories only', async () => {
    const extensionsDir = await makeExtensionsDir();
    await mkdir(path.join(extensionsDir, 'plugin_alpha'));
    await mkdir(path.join(extensionsDir, 'channel_onebot'));
    await mkdir(path.join(extensionsDir, 'not_a_plugin'));

    const loader = new PluginLoader({ extensionsDir });
    const discovered = await loader.discover();

    expect(discovered).toEqual([path.join(extensionsDir, 'plugin_alpha')]);
  });

  it('loads a valid plugin definition through dynamic import', async () => {
    const extensionsDir = await makeExtensionsDir();
    const pluginDir = path.join(extensionsDir, 'plugin_alpha');
    await mkdir(pluginDir);
    await writeFile(
      path.join(pluginDir, 'index.js'),
      "export default { name: 'alpha', version: '1.0.0', async init() {} };\n",
      'utf-8',
    );

    const loader = new PluginLoader({ extensionsDir });
    const loaded = await loader.load(pluginDir);

    expect(loaded.definition.name).toBe('alpha');
    expect(loaded.directoryName).toBe('plugin_alpha');
    expect(loaded.entryPath).toBe(path.join(pluginDir, 'index.js'));
  });

  it('rejects modules without a PluginDefinition export', async () => {
    const extensionsDir = await makeExtensionsDir();
    const pluginDir = path.join(extensionsDir, 'plugin_bad');
    await mkdir(pluginDir);
    await writeFile(path.join(pluginDir, 'index.js'), 'export default { name: 123 };\n', 'utf-8');

    const loader = new PluginLoader({ extensionsDir });

    await expect(loader.load(pluginDir)).rejects.toThrow(/未导出有效的 PluginDefinition/);
  });
});
