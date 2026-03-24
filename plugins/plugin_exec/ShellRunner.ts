import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import type { ShellExecOptions } from './config.ts';
import { resolveRunnerLimits, truncateRunnerOutput } from './runnerShared.ts';

const execAsync = promisify(execCallback);

interface LoggerLike {
  debug: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

export class ShellRunner {
  options: ShellExecOptions;
  log: LoggerLike;
  timeout: number;
  maxOutput: number;

  constructor(options: ShellExecOptions, logger: LoggerLike) {
    this.options = options;
    this.log = logger;
    const limits = resolveRunnerLimits(options, { timeout: 30000, maxOutput: 10000 });
    this.timeout = limits.timeout;
    this.maxOutput = limits.maxOutput;
  }

  truncateOutput(output: string) {
    return truncateRunnerOutput(output, this.maxOutput);
  }

  async execute(command: string, cwd?: string, signal?: AbortSignal): Promise<string> {
    if (typeof command !== 'string' || command.trim().length === 0) {
      return '错误: command 参数必须是非空字符串';
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024,
        signal
      });

      return this.truncateOutput(stderr ? `[stderr]\n${stderr}\n[stdout]\n${stdout}` : stdout);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return '命令执行已取消';
      }

      const message = error instanceof Error ? error.message : String(error);
      return `命令执行错误: ${message}`;
    }
  }
}

export default ShellRunner;
