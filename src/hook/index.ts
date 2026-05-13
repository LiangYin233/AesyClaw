/**
 * hook — 统一的 Hook 体系入口。
 */
export type { HookChain, HookCtx, HookResult, Middleware, HookRegistration } from './types';
export { HooksBus, compose } from './hooks-bus';
export type { IHooksBus } from './hooks-bus';
