import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDefaultRoleFile } from '../../../src/role/default-role';

const TEST_ROOT = path.join(tmpdir(), 'aesyclaw-default-role-test');

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('ensureDefaultRoleFile', () => {
  it('creates the bundled default role when missing', () => {
    const rolesDir = path.join(TEST_ROOT, 'roles');

    ensureDefaultRoleFile(rolesDir);

    const defaultRolePath = path.join(rolesDir, 'default.json');
    expect(existsSync(defaultRolePath)).toBe(true);
    expect(JSON.parse(readFileSync(defaultRolePath, 'utf-8'))).toMatchObject({
      id: 'default',
      enabled: true,
    });
  });
});
