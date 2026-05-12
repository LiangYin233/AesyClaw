import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import type { PluginDefinition } from '@aesyclaw/sdk';
import type { AesyClawTool, ToolExecutionResult } from '@aesyclaw/sdk';

const DEFAULT_TIMEOUT_MS = 30_000;
const POSIX_FORCE_KILL_DELAY_MS = 1_000;

/** exec 工具参数 Schema */
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

/** exec 工具参数类型 */
export type ExecParams = Static<typeof ExecParamsSchema>;

/** 命令执行结果详情 */
export type ExecResultDetails = {
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
};

/** 命令执行选项 */
export type ExecuteCommandOptions = {
  workspaceDir: string;
  platform?: NodeJS.Platform;
};

/**
 * 执行指定的 shell 命令并返回结果。
 *
 * @param params - 命令执行参数（command、cwd、timeoutMs）
 * @param options - 执行选项（工作目录、平台）
 * @returns 工具执行结果
 */
export async function executeCommand(
  params: ExecParams,
  options: ExecuteCommandOptions,
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  const platform = options.platform ?? process.platform;
  const cwd = resolveExecutionCwd(params.cwd, options.workspaceDir);
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const shell = createShellInvocation(params.command, platform);
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let timedOut = false;

  const getStdout = (): string => smartDecodeOutput(Buffer.concat(stdoutChunks), platform);
  const getStderr = (): string => smartDecodeOutput(Buffer.concat(stderrChunks), platform);



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
        stdout: getStdout(),
        stderr: getStderr(),
        error: getErrorMessage(err),
      });
    }
  }
  return await new Promise<ToolExecutionResult>((resolve) => {
    const settle = (
      overrides: Partial<Pick<ExecResultDetails, 'exitCode' | 'signal' | 'error'>> = {},
    ) => {
      const details: ExecResultDetails = {
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
        stdout: getStdout(),
        stderr: getStderr(),
        ...overrides,
      };
      resolve(makeToolResult(details));
    };

    let settled = false;
    const child = (() => {
      try {
        return spawn(shell.command, shell.args, {
          cwd,
          detached: platform !== 'win32',
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PYTHONUTF8: '1',
          },
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
            stdout: getStdout(),
            stderr: getStderr(),
            error: getErrorMessage(err),
          }),
        );
        return null;
      }
    })();

    if (!child) {
      return;
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(toBuffer(chunk));
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(toBuffer(chunk));
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child, platform);
    }, timeoutMs);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      settle({ error: err.message });
    });

    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      settle({ exitCode, signal });
    });
  });
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 创建 exec 工具定义，注册到 SDK 工具系统。
 *
 * @param workspaceDir - 工作区根目录
 * @returns 工具定义
 */
export function createExecTool(workspaceDir: string): AesyClawTool {
  return {
    name: 'exec',
    description:
      'Execute a shell command and return stdout, stderr, exit metadata, cwd, and timeout information.',
    parameters: ExecParamsSchema,
    owner: 'plugin:exec',
    execute: async (params) => await executeCommand(params as ExecParams, { workspaceDir }),
  };
}

const plugin: PluginDefinition = {
  name: 'exec',
  version: '0.1.0',
  description: 'Provides an LLM-facing exec tool for shell command execution.',
  async init(ctx) {
    ctx.registerTool(createExecTool(ctx.paths.workspaceDir));
    ctx.logger.info('Exec plugin initialized');
  },
};

export default plugin;

function resolveExecutionCwd(cwd: string | undefined, workspaceDir: string): string {
  if (cwd) {
    return path.resolve(workspaceDir, cwd);
  }

  return workspaceDir;
}

function createShellInvocation(
  command: string,
  platform: NodeJS.Platform,
): { name: 'powershell' | 'bash'; command: string; args: string[] } {
  if (platform === 'win32') {
    const utf8Command =
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
      '$OutputEncoding = [System.Text.Encoding]::UTF8; ' +
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

function terminateProcessTree(child: ChildProcess, platform: NodeJS.Platform): void {
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
  const failed = details.timedOut || details.error != null || details.exitCode !== 0;

  return {
    content: formatResultContent(details),
    details,
    isError: failed,
  };
}

function toBuffer(chunk: Buffer | string): Buffer {
  return typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
}

export function smartDecodeOutput(
  buf: Buffer,
  platform: NodeJS.Platform = process.platform,
): string {
  if (buf.length === 0) {
    return '';
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Fall through to Windows codepage fallback.
  }

  if (platform === 'win32') {
    try {
      return new TextDecoder('gb18030').decode(buf);
    } catch {
      // Fall through to lossy UTF-8 fallback.
    }
  }

  return buf.toString('utf8');
}

function formatResultContent(details: ExecResultDetails): string {
  let status: string;
  if (details.timedOut) {
    status = 'timed out';
  } else if (details.error) {
    status = 'failed to start';
  } else if (details.exitCode === 0) {
    status = 'succeeded';
  } else {
    status = 'failed';
  }

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
