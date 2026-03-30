import { spawn } from 'child_process';
import type { ShellExecOptions } from './config.ts';
import { resolveRunnerLimits, truncateRunnerOutput } from './runnerShared.ts';

interface LoggerLike {
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

export class ShellRunner {
  getOptions: () => ShellExecOptions;
  log: LoggerLike;

  constructor(getOptions: () => ShellExecOptions, logger: LoggerLike) {
    this.getOptions = getOptions;
    this.log = logger;
  }

  private getConfig(): { timeout: number; maxOutput: number } {
    const options = this.getOptions();
    const limits = resolveRunnerLimits(options, { timeout: 30000, maxOutput: 10000 });
    return {
      timeout: limits.timeout,
      maxOutput: limits.maxOutput
    };
  }

  truncateOutput(output: string, maxOutput: number) {
    return truncateRunnerOutput(output, maxOutput);
  }

  async execute(command: string, cwd?: string, signal?: AbortSignal): Promise<string> {
    if (typeof command !== 'string' || command.trim().length === 0) {
      return '错误: command 参数必须是非空字符串';
    }

    const config = this.getConfig();
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/sh';
    const encodedCommand = isWindows
      ? `$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`
      : command;
    const shellArgs = isWindows ? ['-NoProfile', '-Command', encodedCommand] : ['-c', command];

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let aborted = false;
      let timedOut = false;

      this.log.debug('shell_exec 执行命令', { command, cwd });

      const proc = spawn(shell, shellArgs, {
        cwd,
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8'
        }
      });

      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };

      const onAbort = () => {
        aborted = true;
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 1000);
      };

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 1000);
      }, config.timeout);

      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      proc.stdout.on('data', (data: Buffer | string) => {
        stdout += typeof data === 'string' ? data : data.toString('utf8');
      });

      proc.stderr.on('data', (data: Buffer | string) => {
        stderr += typeof data === 'string' ? data : data.toString('utf8');
      });

      proc.on('error', (error: Error & NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          finish(`命令执行错误: ${isWindows ? 'powershell.exe' : 'sh'} 未找到`);
        } else {
          finish(`命令执行错误: ${error.message}`);
        }
      });

      proc.on('close', (code: number | null) => {
        if (aborted) {
          finish('命令执行已取消');
          return;
        }
        if (timedOut) {
          finish(`命令超时: 执行时间超过 ${config.timeout}ms`);
          return;
        }
        const fullOutput = stderr ? `[stderr]\n${stderr}\n[stdout]\n${stdout}` : stdout;
        this.log.debug('shell_exec 命令返回', { code, output: fullOutput });
        finish(this.truncateOutput(fullOutput, config.maxOutput));
      });
    });
  }
}

export default ShellRunner;
