#!/usr/bin/env node

import { spawn, execSync, ChildProcess } from 'child_process';
import { bootstrap } from './bootstrap/index.js';
import { ConfigLoader } from './config/loader.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 子进程列表
const childProcesses: ChildProcess[] = [];

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
} as const;

// 服务模式类型
type ServiceMode = 'gateway' | 'webui' | 'all';

// 端口配置类型
interface Ports {
  api: number;
  webui: number;
}

function log(color: string, prefix: string, message: string) {
  console.log(`${color}${prefix}${colors.reset} ${message}`);
}

const info = (msg: string) => log(colors.blue, '[INFO]', msg);
const success = (msg: string) => log(colors.green, '[OK]', msg);
const warn = (msg: string) => log(colors.yellow, '[WARN]', msg);
const error = (msg: string) => log(colors.red, '[ERROR]', msg);

// 清理所有子进程
function cleanupProcesses(): void {
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
function setupSignalHandlers(): void {
  const handleShutdown = () => {
    console.log(''); // 换行使输出更清晰
    cleanupProcesses();
    process.exit(0);
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

// 启动进程
function startProcess(name: string, command: string, cwd?: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: cwd || process.cwd(),
      env: process.env,
      stdio: 'inherit'
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
  console.log(`\n${colors.bright}AesyClaw Services Status${colors.reset}\n`);

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
async function startService(mode: ServiceMode, ports: Ports): Promise<void> {
  setupSignalHandlers();

  const commands: Record<ServiceMode, { command: string; cwd?: string }> = {
    gateway: { command: 'tsx --no-cache src/cli.ts gateway' },
    webui: { command: 'npm run dev', cwd: join(process.cwd(), 'webui') },
    all: { command: '' }
  };

  const servicesToStart: Array<{ mode: ServiceMode; name: string }> = [];

  if (mode === 'gateway' || mode === 'all') {
    servicesToStart.push({ mode: 'gateway', name: 'Gateway' });
  }
  if (mode === 'webui' || mode === 'all') {
    servicesToStart.push({ mode: 'webui', name: 'WebUI' });
  }

  await Promise.all(
    servicesToStart.map((service) => {
      const target = commands[service.mode];
      return startProcess(service.name, target.command, target.cwd);
    })
  );
}

// 显示帮助信息
function showHelp(): void {
  const packageJson = JSON.parse(
    readFileSync(join(__dirname, '../package.json'), 'utf-8')
  );

  console.log(`
${colors.bright}AesyClaw CLI v${packageJson.version}${colors.reset}

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
    await bootstrap();
    return;
  }

  // help 命令不需要加载配置
  if (command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  // 其他命令需要加载配置
  const config = await ConfigLoader.load();
  const ports: Ports = {
    api: config.server.apiPort || 18792,
    webui: 5173  // Hardcoded: WebUI port is controlled by webui/vite.config.ts
  };

  switch (command) {
    case 'start': {
      const mode = (args[1] || 'all') as ServiceMode;
      await startService(mode, ports);
      break;
    }
    case 'status':
      getStatus(ports);
      ConfigLoader.stopWatching();
      process.exit(0);
      break;
    default:
      error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  error(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
