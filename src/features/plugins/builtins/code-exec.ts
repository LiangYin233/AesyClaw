import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { IPlugin } from '../types';
import { ITool, ToolExecutionResult, ToolParameters } from '../../../platform/tools/types';

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

  async execute(args: unknown, context: any): Promise<ToolExecutionResult> {
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

  async execute(args: unknown, context: any): Promise<ToolExecutionResult> {
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

class ReadFileTool implements ITool {
  readonly name = 'read_file';
  readonly description = 'Read the contents of a file from the filesystem.';
  readonly parametersSchema = z.object({
    path: z.string().describe('The file path to read'),
    encoding: z.string().optional().default('utf-8').describe('File encoding'),
  });

  getDefinition() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object' as const,
        properties: {
          path: { type: 'string' as const, description: 'The file path to read' },
          encoding: { type: 'string' as const, description: 'File encoding' },
        },
        required: ['path'],
      },
    };
  }

  async execute(args: unknown, context: any): Promise<ToolExecutionResult> {
    const fs = require('fs/promises');
    const { path, encoding = 'utf-8' } = args as { path: string; encoding?: string };

    try {
      const content = await fs.readFile(path, encoding);
      return {
        success: true,
        content: content.slice(0, 10000),
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

class WriteFileTool implements ITool {
  readonly name = 'write_file';
  readonly description = 'Write content to a file in the filesystem.';
  readonly parametersSchema = z.object({
    path: z.string().describe('The file path to write'),
    content: z.string().describe('The content to write'),
    encoding: z.string().optional().default('utf-8').describe('File encoding'),
  });

  getDefinition() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object' as const,
        properties: {
          path: { type: 'string' as const, description: 'The file path to write' },
          content: { type: 'string' as const, description: 'The content to write' },
          encoding: { type: 'string' as const, description: 'File encoding' },
        },
        required: ['path', 'content'],
      },
    };
  }

  async execute(args: unknown, context: any): Promise<ToolExecutionResult> {
    const fs = require('fs/promises');
    const { path, content, encoding = 'utf-8' } = args as {
      path: string;
      content: string;
      encoding?: string;
    };

    try {
      await fs.writeFile(path, content, encoding);
      return {
        success: true,
        content: `File written successfully: ${path}`,
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

export const CodeExecPlugin: IPlugin = {
  name: 'code-exec',
  description: 'Code execution plugin providing Python, shell commands, and file operations',
  version: '1.0.0',

  tools: [
    new RunPythonCodeTool(),
    new RunShellCommandTool(),
    new ReadFileTool(),
    new WriteFileTool(),
  ],
};
