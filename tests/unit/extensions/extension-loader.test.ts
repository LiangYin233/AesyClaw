import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../../../src/core/errors';
import {
  resolveExtensionEntry,
  loadExtensionModule,
} from '../../../src/extension/extension-loader';

describe('extension-loader', () => {
  it('throws EXTENSION_LOAD_FAILED when no entry file exists', async () => {
    await expect(resolveExtensionEntry('/nonexistent/dir', 'Plugin')).rejects.toMatchObject({
      code: ErrorCode.EXTENSION_LOAD_FAILED,
      extensionKind: 'plugin',
      extensionName: 'dir',
    });
  });

  it('throws EXTENSION_LOAD_FAILED when validate returns null', async () => {
    const tmp = await import('node:fs/promises');
    const dir = await tmp.mkdtemp('/tmp/ext-test-');
    await tmp.writeFile(`${dir}/index.ts`, 'export default {};');

    await expect(loadExtensionModule(dir, 'Channel', () => null)).rejects.toMatchObject({
      code: ErrorCode.EXTENSION_LOAD_FAILED,
      extensionKind: 'channel',
      extensionName: expect.any(String),
    });

    await tmp.rm(dir, { recursive: true });
  });
});
