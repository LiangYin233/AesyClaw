/**
 * StartupProfiler — 启动性能监控工具。
 *
 * 用于跟踪和分析应用启动过程中各个步骤的耗时。
 */

import { createScopedLogger } from './logger';

const logger = createScopedLogger('startup-profiler');

export type StartupStep = {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  children?: StartupStep[];
  error?: string;
};

export type StartupProfile = {
  totalDuration: number;
  steps: StartupStep[];
  startTime: number;
  endTime: number;
};

export class StartupProfiler {
  private steps: StartupStep[] = [];
  private stepStack: StartupStep[] = [];
  private startTime: number;
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
    this.startTime = performance.now();
  }

  /**
   * 开始一个新的步骤。
   * @param name - 步骤名称
   */
  startStep(name: string): void {
    if (!this.enabled) return;

    const step: StartupStep = {
      name,
      startTime: performance.now(),
      children: [],
    };

    if (this.stepStack.length > 0) {
      const parent = this.stepStack[this.stepStack.length - 1];
      parent?.children?.push(step);
    } else {
      this.steps.push(step);
    }

    this.stepStack.push(step);
  }

  /**
   * 结束当前步骤。
   * @param error - 可选的错误信息
   */
  endStep(error?: string): void {
    if (!this.enabled) return;

    const step = this.stepStack.pop();
    if (!step) {
      logger.warn('endStep 调用时没有活动步骤');
      return;
    }

    step.endTime = performance.now();
    step.duration = step.endTime - step.startTime;
    if (error) {
      step.error = error;
    }
  }

  /**
   * 执行一个步骤并自动跟踪耗时。
   * @param name - 步骤名称
   * @param fn - 要执行的函数
   * @returns 函数的返回值
   */
  async runStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      return await fn();
    }

    this.startStep(name);
    try {
      const result = await fn();
      this.endStep();
      return result;
    } catch (err) {
      this.endStep(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /**
   * 获取启动性能报告。
   * @returns 启动性能报告
   */
  getProfile(): StartupProfile {
    const endTime = performance.now();
    return {
      totalDuration: endTime - this.startTime,
      steps: this.steps,
      startTime: this.startTime,
      endTime,
    };
  }

  /**
   * 打印启动性能报告到日志。
   */
  printReport(): void {
    if (!this.enabled) return;

    const profile = this.getProfile();
    logger.info('=== 启动性能报告 ===');
    logger.info(`总耗时: ${profile.totalDuration.toFixed(2)}ms`);
    logger.info('');

    this.printSteps(profile.steps, 0);
  }

  /**
   * 获取格式化的性能报告字符串。
   * @returns 格式化的报告
   */
  getFormattedReport(): string {
    const profile = this.getProfile();
    const lines: string[] = [];
    lines.push('=== 启动性能报告 ===');
    lines.push(`总耗时: ${profile.totalDuration.toFixed(2)}ms`);
    lines.push('');

    this.formatSteps(profile.steps, 0, lines);

    return lines.join('\n');
  }

  private printSteps(steps: StartupStep[], indent: number): void {
    for (const step of steps) {
      const prefix = '  '.repeat(indent);
      const duration = step.duration?.toFixed(2) ?? '?';
      const status = step.error ? '✗' : '✓';
      const errorMsg = step.error ? ` (错误: ${step.error})` : '';

      logger.info(`${prefix}${status} ${step.name}: ${duration}ms${errorMsg}`);

      if (step.children && step.children.length > 0) {
        this.printSteps(step.children, indent + 1);
      }
    }
  }

  private formatSteps(steps: StartupStep[], indent: number, lines: string[]): void {
    for (const step of steps) {
      const prefix = '  '.repeat(indent);
      const duration = step.duration?.toFixed(2) ?? '?';
      const status = step.error ? '✗' : '✓';
      const errorMsg = step.error ? ` (错误: ${step.error})` : '';

      lines.push(`${prefix}${status} ${step.name}: ${duration}ms${errorMsg}`);

      if (step.children && step.children.length > 0) {
        this.formatSteps(step.children, indent + 1, lines);
      }
    }
  }

  /**
   * 比较两个性能报告，计算改进百分比。
   * @param baseline - 基准报告
   * @param current - 当前报告
   * @returns 改进百分比（正数表示改进，负数表示退步）
   */
  static compareProfiles(baseline: StartupProfile, current: StartupProfile): number {
    const improvement = ((baseline.totalDuration - current.totalDuration) / baseline.totalDuration) * 100;
    return improvement;
  }
}

/**
 * 创建一个启动进度报告器。
 * @param totalSteps - 总步骤数
 * @param onProgress - 进度回调函数
 */
export class StartupProgressReporter {
  private currentStep = 0;
  private totalSteps: number;
  private onProgress?: (progress: number, step: string) => void;

  constructor(totalSteps: number, onProgress?: (progress: number, step: string) => void) {
    this.totalSteps = totalSteps;
    this.onProgress = onProgress;
  }

  /**
   * 报告步骤完成。
   * @param stepName - 步骤名称
   */
  reportStep(stepName: string): void {
    this.currentStep++;
    const progress = (this.currentStep / this.totalSteps) * 100;
    
    logger.info(`[${this.currentStep}/${this.totalSteps}] ${stepName} (${progress.toFixed(1)}%)`);
    
    if (this.onProgress) {
      this.onProgress(progress, stepName);
    }
  }

  /**
   * 获取当前进度百分比。
   */
  getProgress(): number {
    return (this.currentStep / this.totalSteps) * 100;
  }
}
