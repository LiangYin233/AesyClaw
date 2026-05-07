import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Value } from '@sinclair/typebox/value';
import { afterEach, describe, expect, it } from 'vitest';
import plugin, {
  createExecTool,
  executeCommand,
  type ExecResultDetails,
} from '../../../extensions/plugin_exec/index';
import type { Logger } from '../../../src/core/logger';
import type { AesyClawTool } from '../../../src/tool/tool-registry';

const isWindows = process.platform === 'win32';
let tempDir: string | null = null;

describe('plugin_exec', () => {
  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('exports a valid plugin and registers the exec tool', async () => {
    const tools: AesyClawTool[] = [];

    await plugin.init({
      config: {},
      registerTool(tool) {
        tools.push(tool);
      },
      unregisterTool() {},
      registerCommand() {},
      registerChannel() {},
      logger: makeSilentLogger(),
    });

    expect(plugin).toEqual(
      expect.objectContaining({
        name: 'exec',
        version: '0.1.0',
      }),
    );
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual(
      expect.objectContaining({
        name: 'exec',
        owner: 'plugin:exec',
      }),
    );
    expect(Value.Check(tools[0].parameters, { command: successCommand() })).toBe(true);
    expect(Value.Check(tools[0].parameters, {})).toBe(false);
  });

  it('uses and creates .aesyclaw/workspace as the default cwd', async () => {
    const repoRoot = await makeRepoRoot();
    const result = await executeCommand({ command: cwdCommand() }, { repoRoot });
    const details = result.details as ExecResultDetails;

    expect(result.isError).toBe(false);
    expect(details.shell).toBe(isWindows ? 'powershell' : 'bash');
    expect(details.cwd).toBe(path.join(repoRoot, '.aesyclaw', 'workspace'));
    expect(details.stdout.trim()).toBe(details.cwd);
  });

  it('returns metadata instead of throwing when process spawn rejects input', async () => {
    const repoRoot = await makeRepoRoot();
    const result = await executeCommand(
      { command: successCommand(), cwd: 'bad\0cwd' },
      { repoRoot },
    );
    const details = result.details as ExecResultDetails;

    expect(result.isError).toBe(true);
    expect(details.exitCode).toBeNull();
    expect(details.error).toContain('null bytes');
    expect(details.stdout).toBe('');
    expect(details.stderr).toBe('');
  });

  it('allows cwd override outside the workspace', async () => {
    const repoRoot = await makeRepoRoot();
    const outsideDir = path.join(repoRoot, '..', 'outside-workspace');
    await mkdir(outsideDir, { recursive: true });

    const result = await executeCommand(
      { command: cwdCommand(), cwd: '../outside-workspace' },
      { repoRoot },
    );
    const details = result.details as ExecResultDetails;

    expect(result.isError).toBe(false);
    expect(details.cwd).toBe(path.resolve(repoRoot, '../outside-workspace'));
    expect(details.stdout.trim()).toBe(details.cwd);
  });

  it('returns stdout, stderr, and metadata for non-zero exits', async () => {
    const repoRoot = await makeRepoRoot();
    const result = await executeCommand({ command: failureCommand() }, { repoRoot });
    const details = result.details as ExecResultDetails;

    expect(result.isError).toBe(true);
    expect(details.exitCode).toBe(7);
    expect(details.timedOut).toBe(false);
    expect(details.stdout).toContain('失败');
    expect(details.stderr).toContain('错误');
    expect(result.content).toContain('Command failed');
  });

  it('returns partial output and timeout metadata when execution times out', async () => {
    const repoRoot = await makeRepoRoot();
    const result = await executeCommand(
      { command: timeoutCommand(), timeoutMs: isWindows ? 1_000 : 100 },
      { repoRoot },
    );
    const details = result.details as ExecResultDetails;

    expect(result.isError).toBe(true);
    expect(details.timedOut).toBe(true);
    expect(details.stdout).toContain('start');
    expect(details.stdout).not.toContain('end');
    expect(result.content).toContain('Command timed out');
  });

  it('terminates child processes when execution times out', async () => {
    const repoRoot = await makeRepoRoot();
    const readyPath = path.join(repoRoot, 'child-ready.txt');
    const markerPath = path.join(repoRoot, 'child-survived.txt');
    const result = await executeCommand(
      {
        command: childProcessTimeoutCommand(readyPath, markerPath),
        timeoutMs: isWindows ? 1_000 : 200,
      },
      { repoRoot },
    );
    const details = result.details as ExecResultDetails;

    expect(details.timedOut).toBe(true);
    await expect(waitForFileExists(readyPath)).resolves.toBe(true);

    await delay(2_500);
    await expect(fileExists(markerPath)).resolves.toBe(false);
  });

  it('preserves Chinese command and output text', async () => {
    const repoRoot = await makeRepoRoot();
    const result = await executeCommand({ command: chineseCommand() }, { repoRoot });
    const details = result.details as ExecResultDetails;

    expect(result.isError).toBe(false);
    expect(details.stdout).toContain('你好，世界');
    expect(result.content).toContain('你好，世界');
  });

  it('uses PowerShell on Windows and bash otherwise', () => {
    const tool = createExecTool();

    expect(tool.name).toBe('exec');
    expect(Value.Check(tool.parameters, { command: successCommand(), timeoutMs: 1 })).toBe(true);
  });
});

async function makeRepoRoot(): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'aesyclaw-exec-plugin-'));
  return tempDir;
}

function successCommand(): string {
  return isWindows ? "Write-Output 'ok'" : "printf 'ok\\n'";
}

function cwdCommand(): string {
  return isWindows ? '$PWD.Path' : 'pwd';
}

function failureCommand(): string {
  return isWindows
    ? "Write-Output '失败'; [Console]::Error.WriteLine('错误'); exit 7"
    : "printf '失败\\n'; printf '错误\\n' >&2; exit 7";
}

function timeoutCommand(): string {
  return isWindows
    ? "[Console]::Out.WriteLine('start'); [Console]::Out.Flush(); Start-Sleep -Seconds 5; Write-Output 'end'"
    : "printf 'start\\n'; sleep 5; printf 'end\\n'";
}

function childProcessTimeoutCommand(readyPath: string, markerPath: string): string {
  const childScript =
    `require("node:fs").writeFileSync(${JSON.stringify(readyPath)},"ready");` +
    `setTimeout(()=>require("node:fs").writeFileSync(${JSON.stringify(markerPath)},"survived"),2000);`;

  if (isWindows) {
    const argumentList = `-e ${windowsCommandLineQuote(childScript)}`;
    return [
      `Start-Process -WindowStyle Hidden -FilePath ${psQuote(process.execPath)} -ArgumentList ${psQuote(argumentList)} | Out-Null`,
      `while (-not (Test-Path -LiteralPath ${psQuote(readyPath)})) { Start-Sleep -Milliseconds 20 }`,
      "[Console]::Out.WriteLine('start')",
      '[Console]::Out.Flush()',
      'Start-Sleep -Seconds 5',
    ].join('; ');
  }

  return [
    `${shQuote(process.execPath)} -e ${shQuote(childScript)} &`,
    `while [ ! -e ${shQuote(readyPath)} ]; do sleep 0.02; done`,
    "printf 'start\\n'",
    'sleep 5',
  ].join('; ');
}

function chineseCommand(): string {
  return isWindows ? "Write-Output '你好，世界'" : "printf '你好，世界\\n'";
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function windowsCommandLineQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForFileExists(filePath: string, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fileExists(filePath)) {
      return true;
    }
    await delay(25);
  }
  return fileExists(filePath);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function makeSilentLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}
