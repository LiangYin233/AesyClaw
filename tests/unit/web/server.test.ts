import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/web/server';

let tempDir: string | null = null;

describe('web server', () => {
  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('serves SPA fallback from the injected web dist directory', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'aesyclaw-web-dist-'));
    await writeFile(path.join(tempDir, 'index.html'), '<main>custom dist</main>', 'utf-8');
    const app = createApp({ webDistDir: tempDir });

    const response = await app.request('/some/spa/route');

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('custom dist');
  });
});
