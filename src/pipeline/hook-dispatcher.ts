/**
 * HookDispatcher — 在管道生命周期点调度插件钩子。
 *
 * 插件注册钩子（onReceive、onSend、beforeToolCall、afterToolCall、
 * beforeLLMRequest），由管道在适当的时机调用。
 *
 * 调度规则：
 * - 钩子按注册顺序调用
 * - 如果任何钩子返回终止结果，调度停止并返回该结果
 * - 否则返回默认的继续结果
 */

import type { InboundMessage, PipelineResult } from '../core/types';
import type { BeforeLLMRequestContext, OnSendContext } from './middleware/types';
import type {
  BeforeToolCallHookContext,
  BeforeToolCallHookResult,
  AfterToolCallHookContext,
  AfterToolCallHookResult,
} from '../agent/agent-types';
import type { PluginHooks } from './middleware/types';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('hook-dispatcher');

/**
 * 追踪插件已注册钩子的条目。
 */
type HookEntry = {
  pluginName: string;
  hooks: PluginHooks;
};

/**
 * 调度辅助函数 — 遍历已注册的钩子并调用 `extract` 获取
 * 钩子函数（或 undefined）。`check` 函数决定
 * 钩子结果是否为终止（停止调度）或应继续到下一个钩子。
 *
 * 如果没有钩子产生终止结果，则返回默认值。
 */
async function dispatchHooks<T, D>(
  entries: HookEntry[],
  extract: (hooks: PluginHooks) => ((context: T) => Promise<D>) | undefined,
  check: (result: D) => boolean,
  defaultValue: D,
  context: T,
): Promise<D> {
  for (const entry of entries) {
    const hookFn = extract(entry.hooks);
    if (!hookFn) continue;

    try {
      const result = await hookFn(context);
      if (check(result)) {
        return result;
      }
    } catch (err) {
      logger.error(`插件 "${entry.pluginName}" 中的钩子错误`, err);
    }
  }

  return defaultValue;
}

/** 检查 PipelineResult 是否为终止（block 或 respond） */
function isPipelineResultTerminal(result: PipelineResult): boolean {
  return result.action !== 'continue';
}

/** 默认 PipelineResult */
const CONTINUE_RESULT: PipelineResult = { action: 'continue' };

/** 默认工具调用前结果 */
const EMPTY_BEFORE_TOOL: BeforeToolCallHookResult = {};

/** 默认工具调用后结果 */
const EMPTY_AFTER_TOOL: AfterToolCallHookResult = {};

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
    // 防止重复注册
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

  // ─── 调度方法 ───────────────────────────────────────────

  async dispatchOnReceive(message: InboundMessage): Promise<PipelineResult> {
    return await dispatchHooks(
      this.entries,
      (hooks) => hooks.onReceive,
      isPipelineResultTerminal,
      CONTINUE_RESULT,
      message,
    );
  }

  async dispatchOnSend(context: OnSendContext): Promise<PipelineResult> {
    return await dispatchHooks(
      this.entries,
      (hooks) => hooks.onSend,
      isPipelineResultTerminal,
      CONTINUE_RESULT,
      context,
    );
  }

  async dispatchBeforeToolCall(
    context: BeforeToolCallHookContext,
  ): Promise<BeforeToolCallHookResult> {
    return await dispatchHooks(
      this.entries,
      (hooks) => hooks.beforeToolCall,
      (result) => result.block === true || result.shortCircuit !== undefined,
      EMPTY_BEFORE_TOOL,
      context,
    );
  }

  async dispatchAfterToolCall(context: AfterToolCallHookContext): Promise<AfterToolCallHookResult> {
    return await dispatchHooks(
      this.entries,
      (hooks) => hooks.afterToolCall,
      (result) => result.override !== undefined,
      EMPTY_AFTER_TOOL,
      context,
    );
  }

  async dispatchBeforeLLMRequest(context: BeforeLLMRequestContext): Promise<PipelineResult> {
    return await dispatchHooks(
      this.entries,
      (hooks) => hooks.beforeLLMRequest,
      isPipelineResultTerminal,
      CONTINUE_RESULT,
      context,
    );
  }
}
