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

const ALLOWED_COMMANDS = new Set([
  'ls', 'cat', 'pwd', 'echo', 'head', 'tail', 'wc',
  'grep', 'find', 'curl', 'python3', 'node', 'git',
  'mkdir', 'rm', 'cp', 'mv', 'cd', 'dir', 'type',
]);

const ADDITIONAL_COMMANDS = (process.env.PLUGIN_EXEC_ALLOWED_COMMANDS || '')
  .split(',')
  .filter(Boolean);

const ALL_ALLOWED = new Set([...ALLOWED_COMMANDS, ...ADDITIONAL_COMMANDS]);

const EXEC_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_SIZE = 1024 * 1024;

const FORBIDDEN_CHARS = /[;&|`$<>(){}\\!#*?"'[\]]/;
const PATH_TRAVERSAL = /\.\./;

function validateCommand(cmd: string): { valid: boolean; error?: string; parsedCommand?: string; parsedArgs?: string[] } {
  if (cmd.length > 4096) {
    return { valid: false, error: 'Command too long (max 4096 characters)' };
  }

  if (cmd.includes('\n') || cmd.includes('\r')) {
    return { valid: false, error: 'Command cannot contain newlines' };
  }

  if (FORBIDDEN_CHARS.test(cmd)) {
    return { valid: false, error: 'Command contains forbidden shell characters' };
  }

  if (PATH_TRAVERSAL.test(cmd)) {
    return { valid: false, error: 'Command contains path traversal sequences' };
  }

  const parts = cmd.trim().split(/\s+/);
  const baseCommand = parts[0];

  if (!ALL_ALLOWED.has(baseCommand)) {
    return { valid: false, error: `Command not allowed: ${baseCommand}. Allowed commands: ${[...ALL_ALLOWED].join(', ')}` };
  }

  return { valid: true, parsedCommand: baseCommand, parsedArgs: parts.slice(1) };
}

function autoDecode(buffer: Buffer): string {
  if (buffer.length === 0) return '';
  return buffer.toString('utf-8');
}

function executeCommand(command: string, cwd: string): Promise<{ output: string; exitCode: number; truncated?: boolean }> {
  return new Promise((resolve, reject) => {
    const validation = validateCommand(command);
    if (!validation.valid) {
      reject(new Error(validation.error));
      return;
    }

    const cmd = validation.parsedCommand!;
    const args = validation.parsedArgs || [];

    let stdout = '';
    let stderr = '';
    let truncated = false;

    const proc = spawn(cmd, args, {
      cwd: cwd,
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

const execTool: ITool = {
  name: 'exec',
  description: 'Execute safe shell commands in workspace directory',
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

      if (exitCode !== 0) {
        return {
          success: false,
          content: output + (truncated ? '\n[Output was truncated]' : ''),
          error: `Command failed with exit code: ${exitCode}`
        };
      }

      return {
        success: true,
        content: (output || '(no output)') + (truncated ? '\n[Output was truncated]' : '')
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
  name: 'exec',
  version: '1.1.0',
  description: 'Safe shell command execution plugin with security hardening',
  defaultOptions: {},

  async init(ctx: PluginContext): Promise<void> {
    ctx.toolRegistry.register(execTool);
    ctx.logger.info('exec plugin initialized with security hardening');
    ctx.logger.info(`Allowed commands: ${[...ALL_ALLOWED].join(', ')}`);
  }
};

export default plugin;
