import { describe, expect, it, vi } from 'vitest';
import { createRolesRouter } from '../../../src/web/routes/roles';
import type { RoleConfig } from '../../../src/core/types';
import type { WebUiManagerDependencies } from '../../../src/web/webui-manager';

function makeRole(overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    id: 'default',
    name: 'Default',
    description: 'Default role',
    systemPrompt: 'You are helpful.',
    model: 'openai/gpt-4o',
    toolPermission: { mode: 'allowlist', list: [] },
    skills: [],
    enabled: true,
    ...overrides,
  };
}

function makeDeps(role = makeRole()) {
  return {
    roleManager: {
      getRole: vi.fn(() => role),
      getAllRoles: vi.fn(() => [role]),
      saveRole: vi.fn(async (_id: string, _updated: RoleConfig) => undefined),
    },
    configManager: {
      getConfig: vi.fn(() => ({
        providers: {
          openai: {
            models: {
              'gpt-4o': {},
            },
          },
        },
      })),
    },
  } as unknown as WebUiManagerDependencies;
}

describe('roles routes', () => {
  it('rejects role update body ids that differ from the route id', async () => {
    const deps = makeDeps();
    const router = createRolesRouter(deps);

    const response = await router.request('/default', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'other', name: 'Renamed' }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: 'Role id in request body must match route id' });
    expect(deps.roleManager.saveRole).not.toHaveBeenCalled();
  });

  it('allows omitted or matching role update body ids and persists the route id', async () => {
    const deps = makeDeps();
    const router = createRolesRouter(deps);

    const omittedResponse = await router.request('/default', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    const matchingResponse = await router.request('/default', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'default', name: 'Renamed again' }),
    });

    expect(omittedResponse.status).toBe(200);
    expect(matchingResponse.status).toBe(200);
    expect(deps.roleManager.saveRole).toHaveBeenNthCalledWith(
      1,
      'default',
      expect.objectContaining({ id: 'default', name: 'Renamed' }),
    );
    expect(deps.roleManager.saveRole).toHaveBeenNthCalledWith(
      2,
      'default',
      expect.objectContaining({ id: 'default', name: 'Renamed again' }),
    );
  });
});
