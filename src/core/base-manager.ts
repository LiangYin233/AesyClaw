/**
 * BaseManager — 通用 Manager 基类。
 *
 * 提供统一的生命周期管理：
 * - initialize(deps) — 带幂等性守卫 + 日志
 * - assertInitialized() — 抛出统一错误 + 返回 deps
 * - getDeps() — 类型安全的 deps 访问器
 * - destroy() — 重置状态
 */
import { createScopedLogger, type Logger } from './logger';

export abstract class BaseManager<TDeps = Record<string, unknown>> {
  private initialized = false;
  protected deps: TDeps | null = null;

  private _logger: Logger | undefined;
  protected get logger(): Logger {
    return (this._logger ??= createScopedLogger(this.constructor.name));
  }

  initialize(deps: TDeps): void {
    if (this.initialized) {
      this.logger.warn(`${this.constructor.name} 已初始化 — 跳过`);
      return;
    }
    this.deps = deps;
    this.initialized = true;
    this.logger.info(`${this.constructor.name} 已初始化`);
  }

  protected assertInitialized(): TDeps {
    if (!this.initialized || this.deps === null) {
      throw new Error(`${this.constructor.name} 未初始化`);
    }
    return this.deps;
  }

  protected getDeps(): TDeps {
    return this.assertInitialized();
  }

  destroy(): void {
    this.deps = null;
    this.initialized = false;
  }
}
