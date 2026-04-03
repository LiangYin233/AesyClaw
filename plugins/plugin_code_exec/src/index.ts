import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { IPlugin, PluginContext } from '../../../src/features/plugins/types.js';

const execAsync = promisify(exec);

class RunPythonCodeTool {
  readonly name = 'run_python_code';
  readonly description = 'Execute Python code in a sandboxed environment. Use this when you need to run Python scripts or perform computations.';
  readonly parametersSchema = z.object({
    code: z.string().describe('The Python code to execute'),
    timeout: z.number().int().positive().optional().default(30).describe('Timeout in seconds'),
  });

  async execute(args: unknown, _context: any): Promise<{ success: boolean; content: string; error?: string }> {
    const { code, timeout = 30 } = args as { code: string; timeout?: number };

    try {
      const escapedCode = code.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const command = `python3 -c "${escapedCode}"`;

      const { stdout, stderr } = await execAsync(command, {
        timeout: timeout * 1000,
        maxBuffer: 1024 * 1024,
      });

      if (stderr && !stdout) {
        return {
          success: false,
          content: '',
          error: `Python Error: ${stderr}`,
        };
      }

      return {
        success: true,
        content: stdout.trim() || '(No output)',
      };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

class RunShellCommandTool {
  readonly name = 'run_shell_command';
  readonly description = 'Execute a shell command. Use this for system operations, file manipulation, or running scripts.';
  readonly parametersSchema = z.object({
    command: z.string().describe('The shell command to execute'),
    timeout: z.number().int().positive().optional().default(30).describe('Timeout in seconds'),
    cwd: z.string().optional().describe('Working directory'),
  });

  async execute(args: unknown, _context: any): Promise<{ success: boolean; content: string; error?: string }> {
    const { command, timeout = 30, cwd } = args as {
      command: string;
      timeout?: number;
      cwd?: string;
    };

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: timeout * 1000,
        maxBuffer: 1024 * 1024,
        cwd: cwd || process.cwd(),
      });

      if (stderr && !stdout) {
        return {
          success: false,
          content: '',
          error: `Command Error: ${stderr}`,
        };
      }

      return {
        success: true,
        content: stdout.trim() || '(No output)',
      };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

const pythonTool = new RunPythonCodeTool();
const shellTool = new RunShellCommandTool();

const plugin: IPlugin = {
  name: 'code-exec',
  version: '1.0.0',

  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Initializing code-exec plugin');

    ctx.toolRegistry.register({
      name: pythonTool.name,
      description: pythonTool.description,
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The Python code to execute' },
          timeout: { type: 'number', description: 'Timeout in seconds' },
        },
        required: ['code'],
      },
      execute: pythonTool.execute.bind(pythonTool),
    });

    ctx.toolRegistry.register({
      name: shellTool.name,
      description: shellTool.description,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
          timeout: { type: 'number', description: 'Timeout in seconds' },
          cwd: { type: 'string', description: 'Working directory' },
        },
        required: ['command'],
      },
      execute: shellTool.execute.bind(shellTool),
    });

    ctx.logger.info('code-exec plugin tools registered');
  },
};

export default plugin;
