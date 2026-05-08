import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePaths } from '../../../src/core/path-resolver';

describe('resolvePaths', () => {
  it('should resolve the .aesyclaw runtime layout exactly', () => {
    const root = path.join('repo-root', 'workspace');
    const paths = resolvePaths(root);

    expect(paths.runtimeRoot).toBe(path.join(root, '.aesyclaw'));
    expect(paths.dataDir).toBe(path.join(root, '.aesyclaw', 'data'));
    expect(paths.configFile).toBe(path.join(root, '.aesyclaw', 'config.json'));
    expect(paths.dbFile).toBe(path.join(root, '.aesyclaw', 'data', 'aesyclaw.db'));
    expect(paths.rolesFile).toBe(path.join(root, '.aesyclaw', 'roles.json'));
    expect('rolesDir' in paths).toBe(false);
    expect(paths.mediaDir).toBe(path.join(root, '.aesyclaw', 'media'));
    expect(paths.workspaceDir).toBe(path.join(root, '.aesyclaw', 'workspace'));
    expect(paths.skillsDir).toBe(path.join(root, 'skills'));
    expect(paths.extensionsDir).toBe(path.join(root, 'extensions'));
    expect(paths.webDistDir).toBe(path.join(root, 'dist'));
  });
});
