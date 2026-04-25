import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Application } from '../../src/app';

const TEST_ROOTS: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const testRoot of TEST_ROOTS.splice(0)) {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

describe('Application', () => {
  it('starts and shuts down with an isolated runtime root', async () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'aesyclaw-app-test-'));
    TEST_ROOTS.push(testRoot);
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);

    const app = new Application();

    try {
      await app.start();

      const runtimeRoot = path.join(testRoot, '.aesyclaw');
      const configFile = path.join(runtimeRoot, 'config.json');
      const roleFile = path.join(runtimeRoot, 'roles', 'default.json');
      const dbFile = path.join(runtimeRoot, 'data', 'aesyclaw.db');

      expect(existsSync(runtimeRoot)).toBe(true);
      expect(existsSync(configFile)).toBe(true);
      expect(existsSync(roleFile)).toBe(true);
      expect(existsSync(dbFile)).toBe(true);
      expect(JSON.parse(readFileSync(configFile, 'utf-8'))).toMatchObject({
        server: expect.objectContaining({ logLevel: 'info' }),
        plugins: [],
        mcp: [],
      });
    } finally {
      await app.shutdown();
    }
  });
});
