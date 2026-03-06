/**
 * Hook Pipeline Abstraction
 *
 * Provides a reusable pattern for executing plugin hooks with:
 * - Timeout protection
 * - Error handling
 * - Sequential execution with result chaining
 * - Logging
 */

import { logger } from '../logger/index.js';
import type { Plugin } from './PluginManager.js';

const log = logger.child({ prefix: 'HookPipeline' });

export interface HookPipelineOptions {
  /** Timeout in milliseconds for each hook execution */
  timeout?: number;
  /** Whether to log hook execution */
  verbose?: boolean;
}

/**
 * Base class for hook pipelines with common timeout and error handling logic
 */
abstract class BaseHookPipeline {
  protected timeout: number;
  protected verbose: boolean;

  constructor(
    protected plugins: Plugin[],
    protected hookName: keyof Plugin,
    options: HookPipelineOptions = {}
  ) {
    this.timeout = options.timeout ?? 5000;
    this.verbose = options.verbose ?? false;
  }

  /**
   * Execute a function with timeout protection
   */
  protected async executeWithTimeout<T>(
    fn: (...args: any[]) => Promise<T> | T,
    ...args: any[]
  ): Promise<T> {
    return Promise.race([
      Promise.resolve(fn(...args)) as Promise<T>,
      this.createTimeoutPromise<T>()
    ]);
  }

  /**
   * Create a timeout promise that rejects after the specified duration
   */
  protected createTimeoutPromise<T>(): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Hook ${String(this.hookName)} timed out after ${this.timeout}ms`));
      }, this.timeout);
    });
  }

  /**
   * Log hook execution if verbose mode is enabled
   */
  protected logExecution(pluginName: string): void {
    if (this.verbose) {
      log.debug(`Executing ${String(this.hookName)} for plugin ${pluginName}`);
    }
  }

  /**
   * Log hook execution error
   */
  protected logError(pluginName: string, error: unknown): void {
    log.error(`Plugin ${pluginName} ${String(this.hookName)} error:`, error);
  }
}

/**
 * Generic hook pipeline for transforming data through plugin hooks
 */
export class HookPipeline<TInput, TOutput = TInput> extends BaseHookPipeline {
  /**
   * Execute the hook pipeline
   * @param initial Initial value to transform
   * @param args Additional arguments to pass to hooks
   * @returns Transformed value after all hooks
   */
  async execute(initial: TInput, ...args: any[]): Promise<TOutput> {
    let result: any = initial;

    for (const plugin of this.plugins) {
      const hook = plugin[this.hookName];

      // Skip if plugin doesn't implement this hook
      if (typeof hook !== 'function') {
        continue;
      }

      try {
        this.logExecution(plugin.name);

        // Execute hook with timeout protection
        const hookResult = await this.executeWithTimeout(
          hook.bind(plugin),
          result,
          ...args
        );

        // Update result if hook returned a value
        if (hookResult !== undefined && hookResult !== null) {
          result = hookResult;
        }
      } catch (error) {
        // Log error but continue with other plugins
        this.logError(plugin.name, error);
      }
    }

    return result as TOutput;
  }
}

/**
 * Void hook pipeline for hooks that don't return values
 */
export class VoidHookPipeline extends BaseHookPipeline {
  /**
   * Execute void hooks (hooks that don't return values)
   */
  async execute(...args: any[]): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin[this.hookName];

      if (typeof hook !== 'function') {
        continue;
      }

      try {
        this.logExecution(plugin.name);
        await this.executeWithTimeout(hook.bind(plugin), ...args);
      } catch (error) {
        this.logError(plugin.name, error);
      }
    }
  }
}
