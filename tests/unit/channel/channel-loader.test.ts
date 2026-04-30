import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChannelLoader } from '../../../src/channel/channel-loader';

const TEST_DIRS: string[] = [];

async function makeExtensionsDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'aesyclaw-channel-loader-'));
  TEST_DIRS.push(dir);
  return dir;
}

describe('ChannelLoader', () => {
  afterEach(async () => {
    await Promise.all(TEST_DIRS.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('discovers channel_* directories only', async () => {
    const extensionsDir = await makeExtensionsDir();
    await mkdir(path.join(extensionsDir, 'channel_onebot'));
    await mkdir(path.join(extensionsDir, 'plugin_alpha'));
    await mkdir(path.join(extensionsDir, 'not_a_channel'));

    const loader = new ChannelLoader({ extensionsDir });
    const discovered = await loader.discover();

    expect(discovered).toEqual([path.join(extensionsDir, 'channel_onebot')]);
  });

  it('loads a valid channel definition from a channel factory export', async () => {
    const extensionsDir = await makeExtensionsDir();
    const channelDir = path.join(extensionsDir, 'channel_onebot');
    await mkdir(channelDir);
    await writeFile(
      path.join(channelDir, 'index.js'),
      "export function createOneBotChannel() { return { name: 'onebot', version: '1.0.0', async init() {} }; }\n",
      'utf-8',
    );

    const loader = new ChannelLoader({ extensionsDir });
    const loaded = await loader.load(channelDir);

    expect(loaded.definition.name).toBe('onebot');
    expect(loaded.directoryName).toBe('channel_onebot');
    expect(loaded.entryPath).toBe(path.join(channelDir, 'index.js'));
  });

  it('prefers named channel factories over plugin-shaped default exports', async () => {
    const extensionsDir = await makeExtensionsDir();
    const channelDir = path.join(extensionsDir, 'channel_onebot');
    await mkdir(channelDir);
    await writeFile(
      path.join(channelDir, 'index.js'),
      `export default { name: 'onebot-plugin', version: '1.0.0', async init(ctx) { ctx.registerChannel({ name: 'wrong', version: '1.0.0', async init() {} }); } };
       export function createOneBotChannel() { return { name: 'onebot', version: '1.0.0', async init() {} }; }\n`,
      'utf-8',
    );

    const loader = new ChannelLoader({ extensionsDir });
    const loaded = await loader.load(channelDir);

    expect(loaded.definition.name).toBe('onebot');
  });

  it('rejects modules without a ChannelPlugin export', async () => {
    const extensionsDir = await makeExtensionsDir();
    const channelDir = path.join(extensionsDir, 'channel_bad');
    await mkdir(channelDir);
    await writeFile(path.join(channelDir, 'index.js'), 'export default { name: 123 };\n', 'utf-8');

    const loader = new ChannelLoader({ extensionsDir });

    await expect(loader.load(channelDir)).rejects.toThrow(/未导出有效的 ChannelPlugin/);
  });
});
