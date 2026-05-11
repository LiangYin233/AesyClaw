import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Value } from '@sinclair/typebox/value';
import { afterEach, describe, expect, it } from 'vitest';
import plugin, {
  createExecTool,
  executeCommand,
  smartDecodeOutput,
  type ExecResultDetails,
} from '../../../extensions/plugin_exec/index';
import type { Logger } from '../../../src/core/logger';
import type { AesyClawTool } from '../../../src/tool/tool-registry';

const isWindows = process.platform === 'win32';
let tempDir: string | null = null;

function makePaths(root: string) {
  return {
    runtimeRoot: path.join(root, '.aesyclaw'),
    dataDir: path.join(root, '.aesyclaw', 'data'),
    configFile: path.join(root, '.aesyclaw', 'config.json'),
    dbFile: path.join(root, '.aesyclaw', 'data', 'aesyclaw.db'),
    rolesFile: path.join(root, '.aesyclaw', 'roles.json'),
    mediaDir: path.join(root, '.aesyclaw', 'media'),
    workspaceDir: path.join(root, '.aesyclaw', 'workspace'),
    skillsDir: path.join(root, 'skills'),
    userSkillsDir: path.join(root, '.aesyclaw', 'skills'),
    extensionsDir: path.join(root, 'extensions'),
    webDistDir: path.join(root, 'dist'),
  };
}

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
      paths: makePaths(await makeRepoRoot()),
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
    const workspaceDir = path.join(repoRoot, '.aesyclaw', 'workspace');
    const result = await executeCommand({ command: cwdCommand() }, { workspaceDir });
    const details = result.details as ExecResultDetails;

    expect(result.isError).toBe(false);
    expect(details.shell).toBe(isWindows ? 'powershell' : 'bash');
    expect(details.cwd).toBe(workspaceDir);
    expect(details.stdout.trim()).toBe(details.cwd);
  });

  it('returns metadata instead of throwing when process spawn rejects input', async () => {
    const repoRoot = await makeRepoRoot();
    const result = await executeCommand(
      { command: successCommand(), cwd: 'bad\0cwd' },
      { workspaceDir: path.join(repoRoot, '.aesyclaw', 'workspace') },
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
    const outsideDir = path.join(repoRoot, '.aesyclaw', 'outside-workspace');
    await mkdir(outsideDir, { recursive: true });

    const result = await executeCommand(
      { command: cwdCommand(), cwd: '../outside-workspace' },
      { workspaceDir: path.join(repoRoot, '.aesyclaw', 'workspace') },
    );
    const details = result.details as ExecResultDetails;

    expect(result.isError).toBe(false);
    expect(details.cwd).toBe(path.resolve(repoRoot, '.aesyclaw', 'outside-workspace'));
    expect(details.stdout.trim()).toBe(details.cwd);
  });

  it('returns stdout, stderr, and metadata for non-zero exits', async () => {
    const repoRoot = await makeRepoRoot();
    const result = await executeCommand(
      { command: failureCommand() },
      { workspaceDir: path.join(repoRoot, '.aesyclaw', 'workspace') },
    );
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
      { workspaceDir: path.join(repoRoot, '.aesyclaw', 'workspace') },
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
      { workspaceDir: path.join(repoRoot, '.aesyclaw', 'workspace') },
    );
    const details = result.details as ExecResultDetails;

    expect(details.timedOut).toBe(true);
    await expect(waitForFileExists(readyPath)).resolves.toBe(true);

    await delay(2_500);
    await expect(fileExists(markerPath)).resolves.toBe(false);
  });

  it('preserves Chinese command and output text', async () => {
    const repoRoot = await makeRepoRoot();
    const result = await executeCommand(
      { command: chineseCommand() },
      { workspaceDir: path.join(repoRoot, '.aesyclaw', 'workspace') },
    );
    const details = result.details as ExecResultDetails;

    expect(result.isError).toBe(false);
    expect(details.stdout).toContain('你好，世界');
    expect(result.content).toContain('你好，世界');
  });

  it('passes Python UTF-8 environment variables to child processes', async () => {
    const repoRoot = await makeRepoRoot();
    const result = await executeCommand(
      { command: nodeEnvCommand() },
      { workspaceDir: path.join(repoRoot, '.aesyclaw', 'workspace') },
    );
    const details = result.details as ExecResultDetails;

    expect(result.isError).toBe(false);
    expect(details.stdout.trim()).toBe('utf-8|1');
  });

  it('decodes Windows GB18030 output when UTF-8 decoding fails', () => {
    const gb18030NiHao = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);

    expect(smartDecodeOutput(gb18030NiHao, 'win32')).toBe('你好');
  });

  it('does not truncate large command output', async () => {
    const repoRoot = await makeRepoRoot();
    const payload = 'x'.repeat(40_000);
    const result = await executeCommand(
      { command: printLiteralCommand(payload) },
      { workspaceDir: path.join(repoRoot, '.aesyclaw', 'workspace') },
    );
    const details = result.details as ExecResultDetails;

    expect(result.isError).toBe(false);
    expect(details.stdout.trim()).toBe(payload);
    expect(details.stdout).not.toContain('truncated');
  });

  it('uses PowerShell on Windows and bash otherwise', () => {
    const tool = createExecTool(path.join(tmpdir(), 'aesyclaw-exec-tool-test'));

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

function nodeEnvCommand(): string {
  const script = "console.log(`${process.env.PYTHONIOENCODING ?? ''}|${process.env.PYTHONUTF8 ?? ''}`)";
  return nodeCommand(script);
}

function printLiteralCommand(value: string): string {
  return nodeCommand(`console.log('x'.repeat(${value.length}))`);
}

function nodeCommand(script: string): string {
  return isWindows
    ? `& ${psQuote(process.execPath)} -e ${psQuote(script)}`
    : `${shQuote(process.execPath)} -e ${shQuote(script)}`;
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
  return await fileExists(filePath);
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
