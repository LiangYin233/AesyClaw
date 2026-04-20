/** @file exec 插件
 *
 * 提供 shell 命令执行工具，允许 Agent 在工作区目录中执行命令。
 * 支持 Windows（cmd.exe）和 Unix（/bin/sh）两种执行方式。
 *
 * 安全限制：
 * - 命令在工作区目录（.aesyclaw/workspace/）中执行
 * - 输出大小限制为 1MB，超出部分会被截断
 * - 命令执行超时为 30 秒
 */

import { spawn } from 'child_process';
import { z } from 'zod';
import type { Plugin, PluginContext } from '@/sdk/plugin.js';
import type { Tool, ToolExecuteContext, ToolExecutionResult } from '@/sdk/tools.js';
import { toErrorMessage } from '@/sdk/errors.js';
import { ensureWorkspaceDir } from '@/sdk/paths.js';

/** 工作区目录路径 */
const WORKSPACE_DIR = ensureWorkspaceDir();

/** 命令执行超时（毫秒） */
const EXEC_TIMEOUT_MS = 30_000;
/** 最大输出大小（字节） */
const MAX_OUTPUT_SIZE = 1024 * 1024;

/** 是否在 Windows 平台运行 */
const USE_SHELL_EXECUTION = process.platform === 'win32';
/** Windows UTF-8 编码前缀 */
const CMD_UTF8_PREFIX = 'chcp 65001 > nul &&';

/** 将 Buffer 解码为 UTF-8 字符串 */
function autoDecode(buffer: Buffer): string {
  if (buffer.length === 0) return '';
  return buffer.toString('utf-8');
}

/** 执行 shell 命令
 *
 * 根据平台选择 cmd.exe 或 /bin/sh 执行命令，
 * 收集 stdout/stderr 输出，支持大小限制与超时终止。
 */
function executeCommand(command: string, cwd: string): Promise<{ output: string; exitCode: number; truncated?: boolean }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let truncated = false;

    const proc = USE_SHELL_EXECUTION
      ? spawn('cmd.exe', ['/d', '/s', '/c', `${CMD_UTF8_PREFIX} ${command}`], {
          cwd,
          env: { ...process.env, HOME: process.env.HOME || '/tmp' },
          windowsHide: true,
          timeout: EXEC_TIMEOUT_MS,
        })
      : spawn('/bin/sh', ['-lc', command], {
          cwd,
          env: { ...process.env, HOME: process.env.HOME || '/tmp' },
          windowsHide: true,
          timeout: EXEC_TIMEOUT_MS,
        });

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
    }, EXEC_TIMEOUT_MS);

    proc.stdout?.on('data', (data: Buffer) => {
      if (stdout.length + data.length > MAX_OUTPUT_SIZE) {
        if (!truncated) {
          stdout += '\n[Output truncated due to size limit]';
          truncated = true;
        }
        return;
      }
      stdout += autoDecode(data);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      if (stderr.length + data.length > MAX_OUTPUT_SIZE) {
        if (!truncated) {
          stderr += '\n[Error output truncated due to size limit]';
          truncated = true;
        }
        return;
      }
      stderr += autoDecode(data);
    });

    proc.on('close', (code: number | null) => {
      clearTimeout(timeout);
      const exitCode = code ?? 0;
      const combined = stdout + (stderr ? (stdout ? '\n' : '') + stderr : '');
      resolve({ output: combined, exitCode, truncated });
    });

    proc.on('error', (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/** exec 工具定义 */
const execTool: Tool = {
  name: 'exec',
  description: 'Execute shell commands in the workspace directory.',
  parametersSchema: z.object({
    command: z.string().describe('Command to execute')
  }),

  getDefinition() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute' }
        },
        required: ['command']
      }
    };
  },

  async execute(args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult> {
    try {
      const { command } = args as { command: string };

      const { output, exitCode, truncated } = await executeCommand(command, WORKSPACE_DIR);
      const finalOutput = (output || '(no output)') + (truncated ? '\n[Output was truncated]' : '');

      if (exitCode !== 0 && exitCode !== 1) {
        return {
          success: false,
          content: finalOutput,
          error: `Command failed with exit code: ${exitCode}`
        };
      }

      return {
        success: true,
        content: finalOutput
      };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: toErrorMessage(error)
      };
    }
  }
};

/** exec 插件 */
const plugin: Plugin = {
  name: 'exec',
  version: '1.1.0',
  description: 'Shell command execution plugin',
  defaultOptions: {},

  async init(ctx: PluginContext): Promise<void> {
    ctx.tools.register(execTool);
    ctx.logger.info('exec plugin initialized');
  }
};

export default plugin;
