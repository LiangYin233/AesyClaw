import { spawn } from 'child_process';
import { platform } from 'os';
import type { PythonExecOptions } from './config.ts';
import { resolveRunnerLimits, truncateRunnerOutput } from './runnerShared.ts';

interface LoggerLike {
  debug: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

export class PythonRunner {
  options: PythonExecOptions;
  log: LoggerLike;
  timeout: number;
  maxOutput: number;
  executable: string;

  constructor(options: PythonExecOptions, logger: LoggerLike) {
    this.options = options;
    this.log = logger;
    const limits = resolveRunnerLimits(options, { timeout: 30000, maxOutput: 10000 });
    this.timeout = limits.timeout;
    this.maxOutput = limits.maxOutput;

    // 根据平台选择默认可执行文件
    const defaultExecutable = platform() === 'win32' ? 'python' : 'python3';
    this.executable = options.executable || defaultExecutable;
  }

  truncateOutput(output: string) {
    return truncateRunnerOutput(output, this.maxOutput);
  }

  async execute(code: string, cwd?: string, signal?: AbortSignal): Promise<string> {
    if (typeof code !== 'string') {
      return 'Python 执行错误: code 参数必须是字符串';
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let aborted = false;
      let settled = false;

      const pythonProcess = spawn(this.executable, ['-I', '-B', '-c', code], {
        cwd,
        shell: false,
        windowsHide: true
      });

      const finish = (value: string) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };

      const onAbort = () => {
        aborted = true;
        pythonProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!pythonProcess.killed) {
            pythonProcess.kill('SIGKILL');
          }
        }, 1000);
      };

      const timeoutId = setTimeout(() => {
        timedOut = true;
        pythonProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!pythonProcess.killed) {
            pythonProcess.kill('SIGKILL');
          }
        }, 1000);
      }, this.timeout);

      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      pythonProcess.stdout.on('data', (data: Buffer | string) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data: Buffer | string) => {
        stderr += data.toString();
      });

      pythonProcess.on('error', (error: Error & NodeJS.ErrnoException) => {

        if (error.code === 'ENOENT') {
          finish('Python 未安装或不在 PATH 中。请确保已安装 Python 并添加到系统 PATH。');
        } else {
          finish(`Python 执行错误: ${error.message}`);
        }
      });

      pythonProcess.on('close', (code: number | null) => {
        if (aborted) {
          finish('Python 执行已取消');
          return;
        }

        if (timedOut) {
          finish(`Python 超时: 执行时间超过 ${this.timeout}ms`);
          return;
        }

        if (code !== 0) {
          const errorOutput = stderr || stdout || '未知错误';
          finish(`Python 执行错误:\n${this.truncateOutput(errorOutput)}`);
          return;
        }
        const output = stdout || '代码执行完成（无输出）';
        finish(this.truncateOutput(output));
      });
    });
  }
}

export default PythonRunner;
