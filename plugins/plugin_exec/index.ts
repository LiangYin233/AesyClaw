import { spawn } from 'child_process';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import type { Plugin, PluginContext } from '@/sdk/plugin.js';
import type { Tool, ToolExecuteContext, ToolExecutionResult } from '@/sdk/tools.js';

const WORKSPACE_DIR = path.join(process.cwd(), '.aesyclaw', 'workspace');
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

const EXEC_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_SIZE = 1024 * 1024;

const USE_SHELL_EXECUTION = process.platform === 'win32';
const CMD_UTF8_PREFIX = 'chcp 65001 > nul &&';

function autoDecode(buffer: Buffer): string {
  if (buffer.length === 0) return '';
  return buffer.toString('utf-8');
}

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
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
};

const plugin: Plugin = {
  name: 'exec',
  version: '1.1.0',
  description: 'Shell command execution plugin',
  defaultOptions: {},

  async init(ctx: PluginContext): Promise<void> {
    ctx.toolRegistry.register(execTool);
    ctx.logger.info('exec plugin initialized');
  }
};

export default plugin;
