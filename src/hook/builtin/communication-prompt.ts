/**
 * communication-prompt — 在 prompt:build 链中注入主动沟通规则。
 */
import type { HookCtx, HookRegistration, HookResult, Middleware } from '@aesyclaw/hook';

const COMMUNICATION_PROMPT_HOOK_ID = 'core:communication-prompt';

const COMMUNICATION_SECTION = [
  '## 用户沟通',
  '',
  '1. **主动通报** — 使用 `send_msg` 主动向用户通报当前进展。',
  '2. **禁止询问** — `send_msg` 仅用于单向通知，不要提问或征求确认。',
].join('\n');

const communicationPromptMiddleware: Middleware = async (
  ctx: HookCtx,
  next?: () => Promise<HookResult>,
): Promise<HookResult> => {
  if (
    ctx.isSubAgent !== true &&
    ctx.isCron !== true &&
    ctx.promptSections &&
    ctx.availableToolNames?.includes('send_msg')
  ) {
    ctx.promptSections.push(COMMUNICATION_SECTION);
  }

  return next !== undefined ? await next() : { action: 'next' };
};

export function createCommunicationPromptHook(): HookRegistration {
  return {
    id: COMMUNICATION_PROMPT_HOOK_ID,
    chain: 'prompt:build',
    priority: 150,
    enabled: true,
    handler: communicationPromptMiddleware,
  };
}

export { COMMUNICATION_PROMPT_HOOK_ID };
