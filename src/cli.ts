#!/usr/bin/env node

import { spawn, execSync, ChildProcess } from 'child_process';
import { bootstrap, StartupInterruptedError } from './app/bootstrap/index.js';
import { ConfigLoader } from './config/index.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 子进程列表
const childProcesses: ChildProcess[] = [];

// 服务模式类型
type ServiceMode = 'gateway' | 'webui' | 'all';

// 端口配置类型
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
  shell: boolean;
}

type ChildProcessStdio = ['ignore', 'inherit', 'inherit'];

interface ShutdownState {
  gatewaySignalHandlersReady?: boolean;
  shutdownRequested?: boolean;
}

function log(prefix: string, message: string) {
  console.log(`${prefix} ${message}`);
}

const warn = (msg: string) => log('[WARN]', msg);
const error = (msg: string) => log('[ERROR]', msg);

function createStartTargets(): Record<'webui', StartTarget> {
  return {
    webui: {
      file: process.platform === 'win32' ? 'npm.cmd' : 'npm',
      args: ['run', 'dev'],
      cwd: join(process.cwd(), 'webui')
    }
  };
}

function resolveStartTarget(target: StartTarget): ResolvedStartTarget {
  if (process.platform !== 'win32') {
    return {
      command: target.file,
      args: target.args,
      shell: false
    };
  }

  const lowerFile = target.file.toLowerCase();
  const requiresShell = lowerFile.endsWith('.cmd') || lowerFile.endsWith('.bat');

  if (!requiresShell) {
    return {
      command: target.file,
      args: target.args,
      shell: false
    };
  }

  return {
    command: target.file,
    args: target.args,
    shell: true
  };
}

// 清理所有子进程
export function cleanupProcesses(): void {
  if (childProcesses.length === 0) return;

  for (const child of childProcesses) {
    if (!child.pid || child.killed) continue;

    try {
      if (process.platform === 'win32') {
        // Windows: 使用 taskkill 杀掉进程树
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      } else {
        // Unix: 发送 SIGTERM 信号
        process.kill(child.pid, 'SIGTERM');
      }
    } catch {
      // 进程可能已经退出，忽略错误
    }
  }

  childProcesses.length = 0;
}

// 注册信号处理器
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

// 启动进程
function startProcess(name: string, target: StartTarget): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const resolvedTarget = resolveStartTarget(target);

    const child = spawn(resolvedTarget.command, resolvedTarget.args, {
      shell: resolvedTarget.shell,
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
      error(`Failed to start ${name}: ${err.message}`);
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
        warn(`${name} exited with code ${code}`);
      }
    });
  });
}

// 获取服务状态
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

// 启动服务
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

// 显示帮助信息
function showHelp(): void {
  const packageJson = JSON.parse(
    readFileSync(join(__dirname, '../package.json'), 'utf-8')
  );

  console.log(`
AesyClaw CLI v${packageJson.version}

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
`);
}

// 主函数
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  // gateway 命令直接启动服务
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

  // help 命令不需要加载配置
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
      const config = await ConfigLoader.load();
      const ports: Ports = {
        api: config.server.apiPort || 18792,
        webui: 5173
      };
      getStatus(ports);
      ConfigLoader.stopWatching();
      process.exit(0);
    }
      break;
    default:
      error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    if (err instanceof StartupInterruptedError) {
      process.exit(0);
    }
    error(`Fatal error: ${err.message}`);
    console.error(err);
    process.exit(1);
  });
}
