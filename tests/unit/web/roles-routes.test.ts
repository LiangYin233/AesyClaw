import { describe, expect, it, vi } from 'vitest';
import { createRole, deleteRole, updateRole } from '../../../src/web/services/roles';
import type { RoleConfig } from '../../../src/core/types';
import type { WebUiManagerDependencies } from '../../../src/web/webui-manager';
import { makeRole } from '../../helpers/role';

function makeDeps(role = makeRole()) {
  return {
    roleManager: {
      getRole: vi.fn(() => role),
      getAllRoles: vi.fn(() => [role]),
      createRole: vi.fn(async (body: Partial<RoleConfig>) => ({ ...role, ...body })),
      saveRole: vi.fn(async (_id: string, _updated: RoleConfig) => undefined),
      deleteRole: vi.fn(async (_id: string) => true),
    },
    configManager: {
      get: vi.fn((path: string) => {
        if (path === 'providers.openai') return { models: { 'gpt-4o': {} } };
        return undefined;
      }),
    },
  } as unknown as WebUiManagerDependencies;
}

describe('roles service', () => {
  it('treats blank create id as omitted', async () => {
    const deps = makeDeps();

    await createRole(deps, { id: '   ', model: 'openai/gpt-4o' });

    expect(deps.roleManager.createRole).toHaveBeenCalledWith(
      expect.not.objectContaining({ id: expect.any(String) }),
    );
  });

  it('rejects update when body id differs from route id', async () => {
    const deps = makeDeps();
    await expect(updateRole(deps, 'default', { id: 'other', name: 'Renamed' })).rejects.toThrow(
      '请求体中的角色 id 必须与路由 id 一致',
    );
    expect(deps.roleManager.saveRole).not.toHaveBeenCalled();
  });

  it('allows omitted or matching body id and persists the route id', async () => {
    const deps = makeDeps();
    await updateRole(deps, 'default', { name: 'Renamed' });
    expect(deps.roleManager.saveRole).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({ id: 'default', name: 'Renamed' }),
    );
  });

  it('deletes a role by id', async () => {
    const deps = makeDeps();

    await deleteRole(deps, 'temporary');

    expect(deps.roleManager.deleteRole).toHaveBeenCalledWith('temporary');
  });
});
