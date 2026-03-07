import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { platform } from 'os';
import { loadConfig } from './config.js';
import { PythonRunner } from './PythonRunner.js';
import { ShellRunner } from './ShellRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../..');

let log = console;
let config = null;
let pythonRunner = null;
let shellRunner = null;

const plugin = {
  name: 'exec',
  version: '1.0.0',
  description: '执行 Python 和 Shell 命令的插件',
  defaultConfig: {
    enabled: false,
    options: {
      python: {
        executable: platform() === 'win32' ? 'python' : 'python3',
        timeout: 30000,
        maxOutput: 10000
      },
      shell: {}
    }
  },

  async onLoad(context) {
    if (context.logger) {
      log = context.logger.child({ prefix: 'exec' });
    }

    const options = context.options || {};
    config = loadConfig(options);

    pythonRunner = new PythonRunner({
      executable: config.python.executable,
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

    log.info(`Exec plugin loaded, python executable: ${config.python.executable}`);
  },

  tools: [
    {
      name: 'python_exec',
      description: '使用系统 Python 执行代码。需要用户自行安装所需的 Python 包。超时 30 秒。',
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
        return await pythonRunner.execute(code);
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
