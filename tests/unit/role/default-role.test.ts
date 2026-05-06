import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES_CONFIG } from '../../../src/role/default-role';

describe('DEFAULT_ROLES_CONFIG', () => {
  it('contains the bundled default role as an enabled roles array', () => {
    expect(DEFAULT_ROLES_CONFIG).toHaveLength(1);
    expect(DEFAULT_ROLES_CONFIG[0]).toMatchObject({ id: 'default', enabled: true });
  });
});
