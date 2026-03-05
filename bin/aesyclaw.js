#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// 配置
const config = {
  ports: {
    gateway: 18791,
    api: 18792,
    webui: 5173
  },
  commands: {
    gateway: 'tsx --no-cache src/cli.ts gateway',
    dev: 'tsx watch src/cli.ts',
    webui: 'cd webui && npm run dev'
  }
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(color, prefix, message) {
  console.log(`${color}${prefix}${colors.reset} ${message}`);
}

function info(msg) { log(colors.blue, '[INFO]', msg); }
function success(msg) { log(colors.green, '[OK]', msg); }
function warn(msg) { log(colors.yellow, '[WARN]', msg); }
function error(msg) { log(colors.red, '[ERROR]', msg); }

// 检查端口是否被占用
function isPortInUse(port) {
  try {
    if (process.platform === 'win32') {
      const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      return result.includes('LISTENING');
    } else {
      execSync(`lsof -i :${port}`, { stdio: ['pipe', 'pipe', 'pipe'] });
      return true;
    }
  } catch {
    return false;
  }
}

// 杀掉占用端口的进程
function killPort(port) {
  try {
    if (process.platform === 'win32') {
      const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      const matches = result.match(/LISTENING\s+(\d+)/g);
      if (matches) {
        for (const match of matches) {
          const pid = match.split(/\s+/)[1];
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
        }
        return true;
      }
    } else {
      const result = execSync(`lsof -t -i :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      const pids = result.trim().split('\n');
      for (const pid of pids) {
        execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
      }
      return true;
    }
  } catch {
    // 端口未被占用
  }
  return false;
}

// 启动进程
function startProcess(name, command, cwd = projectRoot, env = {}) {
  info(`Starting ${name}...`);

  const child = spawn(command, {
    shell: true,
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  });

  child.on('error', (err) => {
    error(`Failed to start ${name}: ${err.message}`);
  });

  return child;
}

// 获取服务状态
function getStatus() {
  console.log(`\n${colors.bright}AesyClaw Services Status${colors.reset}\n`);

  const services = [
    { name: 'Gateway', port: config.ports.gateway },
    { name: 'API Server', port: config.ports.api },
    { name: 'WebUI', port: config.ports.webui }
  ];

  for (const service of services) {
    const inUse = isPortInUse(service.port);
    const status = inUse
      ? `${colors.green}Running${colors.reset}`
      : `${colors.dim}Stopped${colors.reset}`;
    console.log(`  ${service.name.padEnd(12)} : ${service.port}  ${status}`);
  }
  console.log('');
}

// 启动服务
async function startService(mode) {
  console.log(`\n${colors.bright}AesyClaw Launcher${colors.reset}\n`);

  if (mode === 'gateway' || mode === 'all') {
    if (isPortInUse(config.ports.gateway)) {
      warn(`Port ${config.ports.gateway} is already in use, killing...`);
      killPort(config.ports.gateway);
    }
    startProcess('Gateway', config.commands.gateway);
  }

  if (mode === 'api' || mode === 'all') {
    if (isPortInUse(config.ports.api)) {
      warn(`Port ${config.ports.api} is already in use, killing...`);
      killPort(config.ports.api);
    }
    startProcess('API Server', config.commands.dev);
  }

  if (mode === 'webui' || mode === 'all') {
    if (isPortInUse(config.ports.webui)) {
      warn(`Port ${config.ports.webui} is already in use, killing...`);
      killPort(config.ports.webui);
    }
    startProcess('WebUI', config.commands.webui);
  }

  // 等待服务启动
  await new Promise(resolve => setTimeout(resolve, 2000));

  success('Services started successfully!\n');
  getStatus();
}

// 停止服务
async function stopService() {
  info('Stopping services...');

  let stopped = false;
  for (const port of Object.values(config.ports)) {
    if (killPort(port)) {
      stopped = true;
    }
  }

  if (stopped) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    success('All services stopped.\n');
  } else {
    warn('No services were running.\n');
  }
}

// 重启服务
async function restartService(mode) {
  await stopService();
  await new Promise(resolve => setTimeout(resolve, 1000));
  await startService(mode);
}

// 主命令处理
const args = process.argv.slice(2);
const command = args[0] || 'status';

switch (command) {
  case 'start':
    await startService(args[1] || 'all');
    break;
  case 'gateway':
    await startService('gateway');
    break;
  case 'webui':
    await startService('webui');
    break;
  case 'api':
    await startService('api');
    break;
  case 'all':
    await startService('all');
    break;
  case 'stop':
    await stopService();
    break;
  case 'restart':
    await restartService(args[1] || 'all');
    break;
  case 'status':
    getStatus();
    break;
  default:
    console.log(`
${colors.bright}AesyClaw CLI${colors.reset}

Usage: node bin/aesyclaw.js <command>

Commands:
  start [mode]   Start services (gateway|webui|api|all)
  stop           Stop all services
  restart        Restart services
  status         Show services status

Examples:
  node bin/aesyclaw.js start all
  node bin/aesyclaw.js start gateway
  node bin/aesyclaw.js status
`);
    process.exit(1);
}
