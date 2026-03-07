import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { loadConfig } from './config.js';
import { PyodideRunner } from './PyodideRunner.js';
import { ShellRunner } from './ShellRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../..');
const PYODIDE_SANDBOX = resolve(PROJECT_ROOT, '.aesyclaw/pyodide');

let log = console;
let config = null;
let pyodideRunner = null;
let shellRunner = null;

const plugin = {
  name: 'exec',
  version: '1.0.0',
  description: '执行 Python 和 Shell 命令的插件',
  defaultConfig: {
    enabled: false,
    options: {
      python: {
        packages: ['pandas', 'requests', 'simplejson', 'matplotlib']
      },
      shell: {},
      hooks: {
        convertPaths: true
      }
    }
  },

  async onLoad(context) {
    if (context.logger) {
      log = context.logger.child({ prefix: 'exec' });
    }

    const options = context.options || {};
    config = loadConfig(options);

    pyodideRunner = new PyodideRunner({
      sandboxDir: '/sandbox',
      mountDir: PYODIDE_SANDBOX,
      pyodideDir: __dirname,
      packages: config.python.packages,
      timeout: config.python.timeout,
      maxOutput: config.python.maxOutput
    }, log);

    shellRunner = new ShellRunner({
      timeout: config.shell.timeout,
      maxOutput: config.shell.maxOutput,
      blockedCommands: config.shell.blockedCommands,
      blockedPaths: config.shell.blockedPaths,
      blockedParams: config.shell.blockedParams
    }, log);

    log.info(`Exec plugin loaded, python packages: ${config.python.packages.join(', ')}`);
  },

  async onBeforeToolCall(params, toolName, context) {
    if (!config.hooks.convertPaths) {
      return;
    }

    if (toolName === 'send_msg_to_user') {
      if (params.media && Array.isArray(params.media)) {
        params.media = params.media.map(p => {
          if (p.startsWith('/sandbox/')) {
            const relativePath = p.replace('/sandbox/', '');
            const fullPath = resolve(PYODIDE_SANDBOX, relativePath);
            log.debug(`Converted sandbox path: ${p} -> ${fullPath}`);
            return fullPath;
          }
          return p;
        });
      }
    }

    return params;
  },

  tools: [
    {
      name: 'python_exec',
      description: '使用 Pyodide (WebAssembly) 执行 Python 代码。已预装常用库：pandas, requests, simplejson, matplotlib。支持文件读写，操作 /sandbox 目录（对应主机 .aesyclaw/pyodide 文件夹）。超时 30 秒。',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '要执行的 Python 代码'
          }
        },
        required: ['code']
      },
      async execute(params) {
        const { code } = params;
        log.debug('Executing python');
        return await pyodideRunner.execute(code);
      }
    },
    {
      name: 'shell_exec',
      description: '执行 Shell 命令。危险命令（删除、格式化、关机等）会被拦截。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的 Shell 命令'
          }
        },
        required: ['command']
      },
      async execute(params) {
        const { command } = params;
        log.debug(`Executing shell: ${command}`);
        return await shellRunner.execute(command);
      }
    }
  ]
};

export default plugin;
