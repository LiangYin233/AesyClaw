/**
 * hooks-bus — 中央 Hook 注册 / 管理 / 派发总线。
 *
 * 所有 hook 通过 HooksBus 统一注册、按优先级排序、
 * 按 enabled 过滤后以中间件链形式执行。
 */
import type { HookChain, HookCtx, HookRegistration, HookResult, Middleware } from './types';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('hooks-bus');

// ─── 接口 ────────────────────────────────────────────────────────

/** Hook 总线公共接口 */
export type IHooksBus = {
  register(reg: HookRegistration): void;
  unregister(id: string): void;
  unregisterByPrefix(prefix: string): void;
  enable(id: string): void;
  disable(id: string): void;
  isEnabled(id: string): boolean;
  dispatch(chain: HookChain, ctx: HookCtx): Promise<HookResult>;
  clear(): void;
};

// ─── compose ─────────────────────────────────────────────────────

/**
 * Koa 风格中间件组合器。
 *
 * 将一组中间件编译为单个 Middleware：
 * - 调用 next() 推进到下一个中间件
 * - 链尾返回 { action: 'next' }
 * - 重复调用 next() 抛出错误
 */
export function compose(middlewares: Middleware[]): Middleware {
  return async (ctx, outerNext) => {
    let index = -1;
    const dispatch = async (i: number): Promise<HookResult> => {
      if (i <= index) throw new Error('next() called multiple times in hook chain');
      index = i;
      const fn = middlewares[i];
      if (!fn) {
        return outerNext !== undefined ? await outerNext() : { action: 'next' };
      }
      return await fn(ctx, () => dispatch(i + 1));
    };
    return await dispatch(0);
  };
}

// ─── 实现 ────────────────────────────────────────────────────────

export class HooksBus implements IHooksBus {
  private chains = new Map<HookChain, HookRegistration[]>();

  /** 注册一个 hook，按 priority 插入已排序的链中 */
  register(reg: HookRegistration): void {
    const list = this.ensureChain(reg.chain);
    const existing = list.findIndex((r) => r.id === reg.id);
    if (existing !== -1) {
      logger.warn(`Hook "${reg.id}" 已注册 — 正在替换`);
      list.splice(existing, 1);
    }
    list.push(reg);
    list.sort((a, b) => a.priority - b.priority);
    logger.debug(`已注册 Hook: ${reg.id} (chain=${reg.chain}, priority=${reg.priority})`);
  }

  /** 注销一个 hook（支持精确 ID 或前缀匹配） */
  unregister(id: string): void {
    this.removeWhere((r) => r.id === id, `已注销 Hook: ${id}`);
  }

  /** 按前缀注销所有匹配的 hook */
  unregisterByPrefix(prefix: string): void {
    this.removeWhere((r) => r.id.startsWith(prefix), `已注销 Hook 前缀: ${prefix}`);
  }

  /** 启用指定 hook */
  enable(id: string): void {
    const reg = this.findById(id);
    if (reg) {
      reg.enabled = true;
      logger.debug(`已启用 Hook: ${id}`);
    }
  }

  /** 禁用指定 hook */
  disable(id: string): void {
    const reg = this.findById(id);
    if (reg) {
      reg.enabled = false;
      logger.debug(`已禁用 Hook: ${id}`);
    }
  }

  /** 查询 hook 是否启用 */
  isEnabled(id: string): boolean {
    return this.findById(id)?.enabled ?? false;
  }

  /**
   * 派发指定链上的所有已启用中间件。
   *
   * 按 priority 升序执行，任一中间件短路（不调 next 或返回非 next）
   * 则停止后续执行。
   */
  async dispatch(chain: HookChain, ctx: HookCtx): Promise<HookResult> {
    const entries = this.chains.get(chain);
    if (!entries || entries.length === 0) {
      return { action: 'next' };
    }

    const enabled = entries.filter((r) => r.enabled);
    if (enabled.length === 0) {
      return { action: 'next' };
    }

    const chainFn = compose(enabled.map((r) => r.handler));
    try {
      return await chainFn(ctx);
    } catch (err) {
      logger.error(`Hook 链 "${chain}" 执行异常`, err);
      return { action: 'next' };
    }
  }

  /** 清除所有注册的 hook */
  clear(): void {
    this.chains.clear();
  }

  // ─── 内部辅助 ──────────────────────────────────────────────

  private ensureChain(chain: HookChain): HookRegistration[] {
    let list = this.chains.get(chain);
    if (!list) {
      list = [];
      this.chains.set(chain, list);
    }
    return list;
  }

  private findById(id: string): HookRegistration | undefined {
    for (const list of this.chains.values()) {
      const found = list.find((r) => r.id === id);
      if (found) return found;
    }
    return undefined;
  }

  private removeWhere(predicate: (r: HookRegistration) => boolean, logMsg: string): void {
    let removed = false;
    for (const [chain, list] of this.chains) {
      const filtered = list.filter((r) => !predicate(r));
      if (filtered.length < list.length) {
        removed = true;
        this.chains.set(chain, filtered);
      }
    }
    if (removed) {
      logger.debug(logMsg);
    }
  }
}
