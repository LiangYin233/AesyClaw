/**
 * skill-prompt — 在 prompt:build 链中注入角色可用技能说明。
 */
import type { HookCtx, HookRegistration, HookResult, Middleware } from '@aesyclaw/hook';
import type { SkillManager } from '@aesyclaw/skill/manager';
import { buildSkillSection } from '@aesyclaw/agent/prompt/sections';

const SKILL_PROMPT_HOOK_ID = 'core:skill-prompt';

function createSkillPromptMiddleware(
  skillManager: Pick<SkillManager, 'getSkillsForRole'>,
): Middleware {
  return async (ctx: HookCtx, next?: () => Promise<HookResult>): Promise<HookResult> => {
    if (ctx.role && ctx.promptSections && ctx.availableToolNames?.includes('load_skill')) {
      const skills = skillManager.getSkillsForRole(ctx.role);
      if (skills.length > 0) {
        ctx.promptSections.push(buildSkillSection(skills));
      }
    }

    return next !== undefined ? await next() : { action: 'next' };
  };
}

export function createSkillPromptHook(
  skillManager: Pick<SkillManager, 'getSkillsForRole'>,
): HookRegistration {
  return {
    id: SKILL_PROMPT_HOOK_ID,
    chain: 'prompt:build',
    priority: 100,
    enabled: true,
    handler: createSkillPromptMiddleware(skillManager),
  };
}

export { SKILL_PROMPT_HOOK_ID };
