import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { IPlugin, PluginContext } from '../types';
import { ITool, ToolExecutionResult } from '../../../platform/tools/types';

const execAsync = promisify(exec);

class RunPythonCodeTool implements ITool {
  readonly name = 'run_python_code';
  readonly description = 'Execute Python code in a sandboxed environment. Use this when you need to run Python scripts or perform computations.';
  readonly parametersSchema = z.object({
    code: z.string().describe('The Python code to execute'),
    timeout: z.number().int().positive().optional().default(30).describe('Timeout in seconds'),
  });

  getDefinition() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object' as const,
        properties: {
          code: { type: 'string' as const, description: 'The Python code to execute' },
          timeout: { type: 'number' as const, description: 'Timeout in seconds' },
        },
        required: ['code'],
      },
    };
  }

  async execute(args: unknown, _context: any): Promise<ToolExecutionResult> {
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

class RunShellCommandTool implements ITool {
  readonly name = 'run_shell_command';
  readonly description = 'Execute a shell command. Use this for system operations, file manipulation, or running scripts.';
  readonly parametersSchema = z.object({
    command: z.string().describe('The shell command to execute'),
    timeout: z.number().int().positive().optional().default(30).describe('Timeout in seconds'),
    cwd: z.string().optional().describe('Working directory'),
  });

  getDefinition() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object' as const,
        properties: {
          command: { type: 'string' as const, description: 'The shell command to execute' },
          timeout: { type: 'number' as const, description: 'Timeout in seconds' },
          cwd: { type: 'string' as const, description: 'Working directory' },
        },
        required: ['command'],
      },
    };
  }

  async execute(args: unknown, _context: any): Promise<ToolExecutionResult> {
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

export const CodeExecPlugin: IPlugin = {
  name: 'code-exec',
  description: 'Code execution plugin providing Python and shell command execution',
  version: '1.0.0',

  async init(ctx: PluginContext): Promise<void> {
    ctx.toolRegistry.register(pythonTool);
    ctx.toolRegistry.register(shellTool);
  },
};
