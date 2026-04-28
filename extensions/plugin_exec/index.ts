import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import type { PluginDefinition } from '../../src/plugin/plugin-types';
import type { AesyClawTool, ToolExecutionResult } from '../../src/tool/tool-registry';

const DEFAULT_TIMEOUT_MS = 30_000;
const POSIX_FORCE_KILL_DELAY_MS = 1_000;

export const ExecParamsSchema = Type.Object({
  command: Type.String({ minLength: 1, description: 'Shell command to execute.' }),
  cwd: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        'Optional working directory. Relative paths resolve from the repository root and may leave the default workspace.',
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Number({
      minimum: 1,
      description: `Optional timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}.`,
    }),
  ),
});

export type ExecParams = Static<typeof ExecParamsSchema>;

export interface ExecResultDetails {
  command: string;
  cwd: string;
  shell: 'powershell' | 'bash';
  shellCommand: string;
  shellArgs: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | string | null;
  timedOut: boolean;
  timeoutMs: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface ExecuteCommandOptions {
  repoRoot?: string;
  platform?: NodeJS.Platform;
}

export async function executeCommand(
  params: ExecParams,
  options: ExecuteCommandOptions = {},
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  const platform = options.platform ?? process.platform;
  const repoRoot = options.repoRoot ?? process.cwd();
  const cwd = resolveExecutionCwd(params.cwd, repoRoot);
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const shell = createShellInvocation(params.command, platform);
  let stdout = '';
  let stderr = '';
  let timedOut = false;

  if (!params.cwd) {
    try {
      await mkdir(cwd, { recursive: true });
    } catch (err) {
      return makeToolResult({
        command: params.command,
        cwd,
        shell: shell.name,
        shellCommand: shell.command,
        shellArgs: shell.args,
        exitCode: null,
        signal: null,
        timedOut,
        timeoutMs,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        error: getErrorMessage(err),
      });
    }
  }

  return new Promise<ToolExecutionResult>((resolve) => {
    let settled = false;
    const child = (() => {
      try {
        return spawn(shell.command, shell.args, {
          cwd,
          detached: platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err) {
        settled = true;
        resolve(
          makeToolResult({
            command: params.command,
            cwd,
            shell: shell.name,
            shellCommand: shell.command,
            shellArgs: shell.args,
            exitCode: null,
            signal: null,
            timedOut,
            timeoutMs,
            durationMs: Date.now() - startedAt,
            stdout,
            stderr,
            error: getErrorMessage(err),
          }),
        );
        return null;
      }
    })();

    if (!child) {
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child, platform);
    }, timeoutMs);

    child.on('error', (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(
        makeToolResult({
          command: params.command,
          cwd,
          shell: shell.name,
          shellCommand: shell.command,
          shellArgs: shell.args,
          exitCode: null,
          signal: null,
          timedOut,
          timeoutMs,
          durationMs: Date.now() - startedAt,
          stdout,
          stderr,
          error: err.message,
        }),
      );
    });

    child.on('close', (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(
        makeToolResult({
          command: params.command,
          cwd,
          shell: shell.name,
          shellCommand: shell.command,
          shellArgs: shell.args,
          exitCode,
          signal,
          timedOut,
          timeoutMs,
          durationMs: Date.now() - startedAt,
          stdout,
          stderr,
        }),
      );
    });
  });
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createExecTool(): AesyClawTool {
  return {
    name: 'exec',
    description:
      'Execute a shell command and return stdout, stderr, exit metadata, cwd, and timeout information.',
    parameters: ExecParamsSchema,
    owner: 'plugin:exec',
    execute: async (params) => executeCommand(params as ExecParams),
  };
}

const plugin: PluginDefinition = {
  name: 'exec',
  version: '0.1.0',
  description: 'Provides an LLM-facing exec tool for shell command execution.',
  async init(ctx) {
    ctx.registerTool(createExecTool());
    ctx.logger.info('Exec plugin initialized');
  },
};

export default plugin;

function resolveExecutionCwd(cwd: string | undefined, repoRoot: string): string {
  if (cwd) {
    return path.resolve(repoRoot, cwd);
  }

  return path.resolve(repoRoot, '.aesyclaw', 'workspace');
}

function createShellInvocation(command: string, platform: NodeJS.Platform) {
  if (platform === 'win32') {
    const utf8Command =
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ' +
      '$OutputEncoding = [Console]::OutputEncoding; ' +
      'chcp 65001 > $null; ' +
      command;
    return {
      name: 'powershell' as const,
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        utf8Command,
      ],
    };
  }

  return {
    name: 'bash' as const,
    command: 'bash',
    args: ['-lc', command],
  };
}

function terminateProcessTree(
  child: ChildProcess,
  platform: NodeJS.Platform,
): void {
  if (child.pid === undefined) {
    child.kill();
    return;
  }

  if (platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => {
      child.kill();
    });
    killer.on('close', (code) => {
      if (code !== 0) {
        child.kill();
      }
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }

  const forceKill = setTimeout(() => {
    if (child.pid === undefined) {
      return;
    }
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, POSIX_FORCE_KILL_DELAY_MS);
  forceKill.unref();
  child.once('close', () => clearTimeout(forceKill));
}

function makeToolResult(details: ExecResultDetails): ToolExecutionResult {
  const failed = details.timedOut || details.error !== undefined || details.exitCode !== 0;

  return {
    content: formatResultContent(details),
    details,
    isError: failed,
  };
}

function formatResultContent(details: ExecResultDetails): string {
  const status = details.timedOut
    ? 'timed out'
    : details.error
      ? 'failed to start'
      : details.exitCode === 0
        ? 'succeeded'
        : 'failed';

  const lines = [
    `Command ${status}`,
    `Command: ${details.command}`,
    `CWD: ${details.cwd}`,
    `Shell: ${details.shell}`,
    `Exit code: ${details.exitCode ?? 'null'}`,
    `Signal: ${details.signal ?? 'null'}`,
    `Timed out: ${details.timedOut}`,
    `Timeout ms: ${details.timeoutMs}`,
    `Duration ms: ${details.durationMs}`,
  ];

  if (details.error) {
    lines.push(`Error: ${details.error}`);
  }

  lines.push('STDOUT:', details.stdout, 'STDERR:', details.stderr);
  return lines.join('\n');
}
