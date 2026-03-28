#!/usr/bin/env node

import { spawn, execSync, ChildProcess } from 'child_process';
import { bootstrap, StartupInterruptedError } from './app/bootstrap/index.js';
import { defaultConfigService } from './features/config/index.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 当前命令行工具拉起的子进程列表。
const childProcesses: ChildProcess[] = [];

// 命令行工具支持的启动模式。
type ServiceMode = 'gateway' | 'webui' | 'all';

// `status` 命令展示的端口信息。
interface Ports {
  api: number;
  webui: number;
}

interface StartTarget {
  file: string;
  args: string[];
  cwd?: string;
}

interface ResolvedStartTarget {
  command: string;
  args: string[];
}

type ChildProcessStdio = ['ignore', 'inherit', 'inherit'];

interface ShutdownState {
  gatewaySignalHandlersReady?: boolean;
  shutdownRequested?: boolean;
}

function createStartTargets(): Record<'webui', StartTarget> {
  return {
    webui: {
      file: process.platform === 'win32' ? 'npm.cmd' : 'npm',
      args: ['run', 'dev'],
      cwd: join(process.cwd(), 'webui')
    }
  };
}

export function buildHelpText(version: string): string {
  return `
AesyClaw CLI v${version}

Usage: tsx src/cli.ts <command> [options]

Commands:
  gateway        Start gateway service directly (single process)
  start [mode]   Start services in background (gateway|webui|all)
  status         Show configured ports

Examples:
  tsx src/cli.ts gateway
  tsx src/cli.ts start all
  tsx src/cli.ts start gateway
  tsx src/cli.ts status
`;
}

function quoteWindowsArgument(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  if (!/[ \t"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

export function resolveStartTarget(target: StartTarget): ResolvedStartTarget {
  if (process.platform !== 'win32') {
    return {
      command: target.file,
      args: target.args
    };
  }

  const lowerFile = target.file.toLowerCase();
  const requiresShell = lowerFile.endsWith('.cmd') || lowerFile.endsWith('.bat');

  if (!requiresShell) {
    return {
      command: target.file,
      args: target.args
    };
  }

  const shellCommand = [target.file, ...target.args]
    .map(quoteWindowsArgument)
    .join(' ');

  return {
    command: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', shellCommand]
  };
}

// 关闭当前命令行工具管理的所有子进程。
export function cleanupProcesses(): void {
  if (childProcesses.length === 0) return;

  for (const child of childProcesses) {
    if (!child.pid || child.killed) continue;

    try {
      if (process.platform === 'win32') {
        // Windows 下直接终止整个进程树，避免残留子进程。
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      } else {
        // 其他平台先发送 SIGTERM，交给子进程自行收尾。
        process.kill(child.pid, 'SIGTERM');
      }
    } catch {
      // 进程可能已提前退出，这里按幂等清理处理。
    }
  }

  childProcesses.length = 0;
}

// `webui` 模式下由命令行工具负责退出；其他模式交给主服务接管生命周期。
export function shouldCliExitOnShutdown(mode: ServiceMode): boolean {
  return mode === 'webui';
}

export function getChildProcessStdio(): ChildProcessStdio {
  return ['ignore', 'inherit', 'inherit'];
}

function setupSignalHandlers(mode: ServiceMode, state: ShutdownState = {}): void {
  let shuttingDown = false;

  const handleShutdown = () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    state.shutdownRequested = true;
    console.log(''); // 换行使输出更清晰
    cleanupProcesses();

    if (shouldCliExitOnShutdown(mode)) {
      process.exit(0);
    }
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

// 启动一个外部进程，并在成功后纳入统一清理列表。
function startProcess(name: string, target: StartTarget): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const resolvedTarget = resolveStartTarget(target);

    const child = spawn(resolvedTarget.command, resolvedTarget.args, {
      cwd: target.cwd || process.cwd(),
      env: process.env,
      stdio: getChildProcessStdio()
    });

    let settled = false;

    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      childProcesses.push(child);
      resolve(child);
    });

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    child.on('exit', (code, signal) => {
      const index = childProcesses.indexOf(child);
      if (index > -1) {
        childProcesses.splice(index, 1);
      }

      if (code !== null && code !== 0 && !signal) {
      }
    });
  });
}

// 输出当前配置中的服务端口。
function getStatus(ports: Ports): void {
  console.log('\nAesyClaw Services Status\n');

  const services = [
    { name: 'API Server', port: ports.api },
    { name: 'WebUI', port: ports.webui }
  ];

  for (const service of services) {
    console.log(`  ${service.name.padEnd(12)} : ${service.port}`);
  }
  console.log('');
}

// 等待一组启动任务完成；只要有一项失败就触发统一清理。
export async function runStartupTasks(
  startupTasks: Array<Promise<unknown>>,
  cleanup: () => void = cleanupProcesses
): Promise<void> {
  try {
    await Promise.all(startupTasks);
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function startService(mode: ServiceMode): Promise<void> {
  const shutdownState: ShutdownState = {
    gatewaySignalHandlersReady: false,
    shutdownRequested: false
  };
  setupSignalHandlers(mode, shutdownState);

  const targets = createStartTargets();

  const startupTasks: Array<Promise<unknown>> = [];

  if (mode === 'webui' || mode === 'all') {
    startupTasks.push(startProcess('WebUI', targets.webui));
  }

  if (mode === 'gateway' || mode === 'all') {
    startupTasks.push(bootstrap({
      onSignalHandlersReady: () => {
        shutdownState.gatewaySignalHandlersReady = true;
      },
      shouldAbortStartup: () => shutdownState.shutdownRequested === true
    }));
  }

  await runStartupTasks(startupTasks);
}

// 输出命令行帮助文本。
function showHelp(): void {
  const packageJson = JSON.parse(
    readFileSync(join(__dirname, '../package.json'), 'utf-8')
  );

  console.log(buildHelpText(packageJson.version));
}

// 命令行主入口。
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  // `gateway` 直接进入主服务，不再额外派生子进程。
  if (command === 'gateway') {
    const shutdownState: ShutdownState = {
      gatewaySignalHandlersReady: false,
      shutdownRequested: false
    };
    setupSignalHandlers('gateway', shutdownState);
    await bootstrap({
      onSignalHandlersReady: () => {
        shutdownState.gatewaySignalHandlersReady = true;
      },
      shouldAbortStartup: () => shutdownState.shutdownRequested === true
    });
    return;
  }

  // 帮助命令不依赖运行时配置。
  if (command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  switch (command) {
    case 'start': {
      const mode = (args[1] || 'all') as ServiceMode;
      await startService(mode);
      break;
    }
    case 'status': {
      const config = await defaultConfigService.load();
      const ports: Ports = {
        api: config.server.apiPort || 18792,
        webui: 5173
      };
      getStatus(ports);
      defaultConfigService.stopWatching();
      process.exit(0);
    }
      break;
    default:
      showHelp();
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    if (err instanceof StartupInterruptedError) {
      process.exit(0);
    }
    process.exit(1);
  });
}
