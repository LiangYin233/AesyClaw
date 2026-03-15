import { spawn } from 'child_process';
import { platform } from 'os';
import type { PythonExecOptions } from './config.ts';

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
    this.timeout = options.timeout || 30000;
    this.maxOutput = options.maxOutput || 10000;

    // 根据平台选择默认可执行文件
    const defaultExecutable = platform() === 'win32' ? 'python' : 'python3';
    this.executable = options.executable || defaultExecutable;
  }

  truncateOutput(output: string) {
    if (!output) return '';
    if (output.length <= this.maxOutput) return output;
    return output.substring(0, this.maxOutput) + `\n[输出已截断，原始长度: ${output.length} 字符]`;
  }

  async execute(code: string, cwd?: string): Promise<string> {
    if (typeof code !== 'string') {
      return 'Python 执行错误: code 参数必须是字符串';
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const pythonProcess = spawn(this.executable, ['-c', code], {
        cwd,
        shell: false,
        windowsHide: true
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        pythonProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!pythonProcess.killed) {
            pythonProcess.kill('SIGKILL');
          }
        }, 1000);
      }, this.timeout);

      pythonProcess.stdout.on('data', (data: Buffer | string) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data: Buffer | string) => {
        stderr += data.toString();
      });

      pythonProcess.on('error', (error: Error & NodeJS.ErrnoException) => {
        clearTimeout(timeoutId);
        this.log.error('Python process failed', { error: error.message });

        if (error.code === 'ENOENT') {
          resolve('Python 未安装或不在 PATH 中。请确保已安装 Python 并添加到系统 PATH。');
        } else {
          resolve(`Python 执行错误: ${error.message}`);
        }
      });

      pythonProcess.on('close', (code: number | null) => {
        clearTimeout(timeoutId);

        if (timedOut) {
          this.log.warn(`Python execution timed out after ${this.timeout}ms`);
          resolve(`Python 超时: 执行时间超过 ${this.timeout}ms`);
          return;
        }

        if (code !== 0) {
          this.log.debug(`Python exited with code ${code}`);
          const errorOutput = stderr || stdout || '未知错误';
          resolve(`Python 执行错误:\n${this.truncateOutput(errorOutput)}`);
          return;
        }

        this.log.debug('Python execution completed', { executable: this.executable });
        const output = stdout || '代码执行完成（无输出）';
        resolve(this.truncateOutput(output));
      });
    });
  }
}

export default PythonRunner;
