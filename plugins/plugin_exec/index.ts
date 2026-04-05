import { spawn } from 'child_process';
import { IPlugin, PluginContext } from '../../src/features/plugins/types';
import { ITool, ToolExecuteContext, ToolExecutionResult } from '../../src/platform/tools/types';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';

const WORKSPACE_DIR = path.join(process.cwd(), '.aesyclaw', 'workspace');
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

function autoDecode(buffer: Buffer): string {
  if (buffer.length === 0) return '';
  
  const utf8Text = buffer.toString('utf-8');
  if (!utf8Text.includes('\uFFFD')) {
    return utf8Text;
  }
  
  const latin1Text = buffer.toString('latin1');
  if (containsHighBytes(buffer)) {
    return latin1Text;
  }
  
  return latin1Text;
}

function containsHighBytes(buffer: Buffer): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] > 0x7F) {
      return true;
    }
  }
  return false;
}

function execCommand(command: string, cwd: string): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/sh';
    const args = isWindows ? ['-NoProfile', '-Command', command] : ['-c', command];

    const proc = spawn(shell, args, {
      cwd: cwd,
      env: { ...process.env },
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += autoDecode(data);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += autoDecode(data);
    });

    proc.on('close', (code: number | null) => {
      const exitCode = code ?? 0;
      const combined = stdout + (stderr ? (stdout ? '\n' : '') + stderr : '');
      resolve({ output: combined, exitCode });
    });

    proc.on('error', (error: Error) => {
      reject(error);
    });
  });
}

const execTool: ITool = {
  name: 'exec',
  description: '执行 Shell 命令',
  parametersSchema: z.object({
    command: z.string().describe('要执行的命令')
  }),
  
  getDefinition() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令' }
        },
        required: ['command']
      }
    };
  },
  
  async execute(args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult> {
    try {
      const { command } = args as { command: string };

      const { output, exitCode } = await execCommand(command, WORKSPACE_DIR);

      if (exitCode !== 0) {
        return {
          success: false,
          content: output,
          error: `命令执行失败，退出码: ${exitCode}`
        };
      }

      return {
        success: true,
        content: output || '(无输出)'
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

const plugin: IPlugin = {
  name: 'exec-plugin',
  version: '1.0.0',
  description: 'Shell 命令执行插件',
  defaultOptions: {},
  
  async init(ctx: PluginContext): Promise<void> {
    ctx.toolRegistry.register(execTool);
    ctx.logger.info('exec 插件已初始化');
  }
};

export default plugin;
