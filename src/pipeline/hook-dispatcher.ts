/**
 * HookDispatcher — 在管道生命周期点调度插件钩子。
 *
 * 插件注册钩子（onReceive、onSend、beforeLLM、beforeToolCall、
 * afterToolCall），由管道在适当的时机调用。
 *
 * 调度规则：
 * - 钩子按注册顺序调用
 * - 如果任何钩子返回终止结果，调度停止并返回该结果
 * - 否则返回默认的继续结果
 *
 * 相比旧版：
 * - 保留 5 个显式 dispatch 方法作为公开入口
 * - 通过私有 helper 复用遍历、错误处理和短路逻辑
 * - 移除了 CONTINUE_RESULT / EMPTY_BEFORE_TOOL / EMPTY_AFTER_TOOL 常量
 */

import type { PipeCtx, SendCtx, PluginHooks } from './types';
import type {
  BeforeToolCallHookContext,
  BeforeToolCallHookResult,
  AfterToolCallHookContext,
  AfterToolCallHookResult,
} from '@aesyclaw/agent/agent-types';
import type { PipelineResult } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('hook-dispatcher');

/** 追踪插件已注册钩子的条目 */
type HookEntry = {
  pluginName: string;
  hooks: PluginHooks;
};

/** 检查 PipelineResult 是否为终止（block 或 respond） */
function isTerminal(result: PipelineResult): boolean {
  return result.action !== 'continue';
}

/**
 * 完整的 HookDispatcher 实现。
 *
 * 作为 Pipeline 的内部组件，负责实际遍历和调用插件钩子。
 * 同时提供插件钩子注册/注销和工具钩子调度的功能。
 */
export class HookDispatcher {
  private entries: HookEntry[] = [];

  // ─── 注册 ───────────────────────────────────────────────

  /**
   * 注册插件的钩子。
   *
   * @param pluginName - 唯一插件标识符（用于注销）
   * @param hooks - 包含插件提供的钩子函数的对象
   */
  register(pluginName: string, hooks: PluginHooks): void {
    const existing = this.entries.find((e) => e.pluginName === pluginName);
    if (existing) {
      logger.warn(`插件 "${pluginName}" 已注册钩子 — 正在替换`);
      existing.hooks = hooks;
      return;
    }
    this.entries.push({ pluginName, hooks });
    logger.debug(`已注册插件钩子: ${pluginName}`);
  }

  /**
   * 注销插件的钩子。
   *
   * 如果插件没有已注册的钩子，则为空操作。
   */
  unregister(pluginName: string): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.pluginName !== pluginName);
    if (this.entries.length < before) {
      logger.debug(`已注销插件钩子: ${pluginName}`);
    }
  }

  /**
   * 清除所有已注册的钩子条目。
   */
  clearAll(): void {
    this.entries = [];
  }

  private async dispatchPipelineHook<TCtx>(
    hookName: string,
    getHook: (hooks: PluginHooks) => ((ctx: TCtx) => Promise<PipelineResult>) | undefined,
    ctx: TCtx,
  ): Promise<PipelineResult> {
    for (const entry of this.entries) {
      const hookFn = getHook(entry.hooks);
      if (!hookFn) continue;

      try {
        const result = await hookFn(ctx);
        if (isTerminal(result)) return result;
      } catch (err) {
        logger.error(`插件 "${entry.pluginName}" 中的 ${hookName} 钩子错误`, err);
      }
    }

    return { action: 'continue' };
  }

  private async dispatchToolHook<TCtx, TResult extends object>(
    hookName: string,
    getHook: (hooks: PluginHooks) => ((ctx: TCtx) => Promise<TResult>) | undefined,
    ctx: TCtx,
    shouldStop: (result: TResult) => boolean,
  ): Promise<TResult | undefined> {
    for (const entry of this.entries) {
      const hookFn = getHook(entry.hooks);
      if (!hookFn) continue;

      try {
        const result = await hookFn(ctx);
        if (shouldStop(result)) return result;
      } catch (err) {
        logger.error(`插件 "${entry.pluginName}" 中的 ${hookName} 钩子错误`, err);
      }
    }

    return undefined;
  }

  // ─── 调度方法 ───────────────────────────────────────────

  /**
   * 派发 onReceive 钩子 — 消息进入管道后的第一步。
   * 返回终止结果或默认 continue。
   */
  async onReceive(ctx: PipeCtx): Promise<PipelineResult> {
    return await this.dispatchPipelineHook('onReceive', (hooks) => hooks.onReceive, ctx);
  }

  /**
   * 派发 onSend 钩子 — 出站消息发送前。
   * 返回终止结果或默认 continue。
   */
  async onSend(ctx: SendCtx): Promise<PipelineResult> {
    return await this.dispatchPipelineHook('onSend', (hooks) => hooks.onSend, ctx);
  }

  /**
   * 派发 beforeLLM 钩子 — Agent 处理 LLM 调用前。
   * session/agent/role 均已解析完毕。返回终止结果或默认 continue。
   */
  async beforeLLM(ctx: PipeCtx): Promise<PipelineResult> {
    return await this.dispatchPipelineHook('beforeLLM', (hooks) => hooks.beforeLLM, ctx);
  }

  /**
   * 派发 beforeToolCall 钩子 — 工具执行前。
   * 如果某钩子返回 block 或 shortCircuit，则停止调度并返回该结果。
   */
  async beforeToolCall(ctx: BeforeToolCallHookContext): Promise<BeforeToolCallHookResult> {
    return (
      (await this.dispatchToolHook(
        'beforeToolCall',
        (hooks) => hooks.beforeToolCall,
        ctx,
        (result) => result.block === true || result.shortCircuit !== undefined,
      )) ?? {}
    );
  }

  /**
   * 派发 afterToolCall 钩子 — 工具执行后。
   * 如果某钩子返回 override，则停止调度并返回该结果。
   */
  async afterToolCall(ctx: AfterToolCallHookContext): Promise<AfterToolCallHookResult> {
    return (
      (await this.dispatchToolHook(
        'afterToolCall',
        (hooks) => hooks.afterToolCall,
        ctx,
        (result) => result.override !== undefined,
      )) ?? {}
    );
  }
}
