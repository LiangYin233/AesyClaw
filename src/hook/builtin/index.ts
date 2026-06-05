/**
 * builtin — 内置 Hook 实现。
 */
export { createAutoCompactHook, AUTO_COMPACT_HOOK_ID } from './auto-compact';
export { createTimeInjectHook, TIME_INJECT_HOOK_ID } from './time-inject';
export {
  createUserInputBudgetGuardHook,
  USER_INPUT_BUDGET_GUARD_HOOK_ID,
} from './user-input-budget-guard';
export { createCommandDetectHook } from './command-detect';
export { createSkillPromptHook, SKILL_PROMPT_HOOK_ID } from './skill-prompt';
export { createRolePromptHook, ROLE_PROMPT_HOOK_ID } from './role-prompt';
export {
  createCommunicationPromptHook,
  COMMUNICATION_PROMPT_HOOK_ID,
} from './communication-prompt';
export {
  createToolResultTruncationHook,
  limitToolResultContent,
} from './tool-result-truncation';
