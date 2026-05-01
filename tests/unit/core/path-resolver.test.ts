import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PathResolver } from '../../../src/core/path-resolver';

describe('PathResolver', () => {
  it('should resolve the .aesyclaw runtime layout exactly', () => {
    const root = path.join('repo-root', 'workspace');
    const resolver = new PathResolver();

    resolver.resolve(root);

    expect(resolver.runtimeRoot).toBe(path.join(root, '.aesyclaw'));
    expect(resolver.dataDir).toBe(path.join(root, '.aesyclaw', 'data'));
    expect(resolver.configFile).toBe(path.join(root, '.aesyclaw', 'config.json'));
    expect(resolver.dbFile).toBe(path.join(root, '.aesyclaw', 'data', 'aesyclaw.db'));
    expect(resolver.rolesDir).toBe(path.join(root, '.aesyclaw', 'roles'));
    expect(resolver.mediaDir).toBe(path.join(root, '.aesyclaw', 'media'));
    expect(resolver.workspaceDir).toBe(path.join(root, '.aesyclaw', 'workspace'));
    expect(resolver.skillsDir).toBe(path.join(root, 'skills'));
    expect(resolver.extensionsDir).toBe(path.join(root, 'extensions'));
  });
});
