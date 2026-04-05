import { spawn } from 'child_process';
import { IPlugin, PluginContext } from '../../src/features/plugins/types';
import { ITool, ToolExecuteContext, ToolExecutionResult } from '../../src/platform/tools/types';
import { z } from 'zod';
import * as path from 'path';

const DEFAULT_WORKDIR = path.join(process.cwd(), '.aesyclaw', 'workspace');

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

function execCommand(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, [], {
      shell: true,
      cwd: cwd,
      env: { ...process.env }
    });
    
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    
    proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    
    proc.on('close', () => {
      const stdout = autoDecode(Buffer.concat(stdoutChunks));
      const stderr = autoDecode(Buffer.concat(stderrChunks));
      
      const output = stdout + (stderr ? (stdout ? '\n' : '') + stderr : '');
      resolve(output);
    });
    
    proc.on('error', reject);
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
      
      const result = await execCommand(command, DEFAULT_WORKDIR);
      
      return {
        success: true,
        content: result
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
