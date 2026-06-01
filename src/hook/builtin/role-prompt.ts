/**
 * role-prompt — 在 prompt:build 链中注入可用角色说明。
 */
import type { HookCtx, HookRegistration, HookResult, Middleware } from '@aesyclaw/hook';
import type { RoleManager } from '@aesyclaw/role/manager';
import { buildRoleSection } from '@aesyclaw/agent/prompt/sections';

const ROLE_PROMPT_HOOK_ID = 'core:role-prompt';

function createRolePromptMiddleware(roleManager: Pick<RoleManager, 'getEnabledRoles'>): Middleware {
  return async (ctx: HookCtx, next?: () => Promise<HookResult>): Promise<HookResult> => {
    if (ctx.isSubAgent !== true && ctx.finalPromptSections) {
      const roles = roleManager.getEnabledRoles();
      if (roles.length > 0) {
        ctx.finalPromptSections.push(buildRoleSection(roles));
      }
    }

    return next !== undefined ? await next() : { action: 'next' };
  };
}

export function createRolePromptHook(
  roleManager: Pick<RoleManager, 'getEnabledRoles'>,
): HookRegistration {
  return {
    id: ROLE_PROMPT_HOOK_ID,
    chain: 'prompt:build',
    priority: 200,
    enabled: true,
    handler: createRolePromptMiddleware(roleManager),
  };
}

export { ROLE_PROMPT_HOOK_ID };
