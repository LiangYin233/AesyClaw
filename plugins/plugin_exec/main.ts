import { platform } from 'os';
import { loadConfig } from './config.js';
import { PythonRunner } from './PythonRunner.js';
import { ShellRunner } from './ShellRunner.js';

const plugin: any = {
  name: 'plugin_exec',
  version: '1.0.0',
  description: '执行 Python 或 Shell。',

  log: console,
  config: null,
  pythonRunner: null,
  shellRunner: null,

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
      this.log = context.logger.child({ prefix: 'exec' });
    }

    const options = context.options || {};
    this.config = loadConfig(options);

    this.pythonRunner = new PythonRunner({
      executable: this.config.python.executable,
      timeout: this.config.python.timeout,
      maxOutput: this.config.python.maxOutput
    }, this.log);

    this.shellRunner = new ShellRunner({
      timeout: this.config.shell.timeout,
      maxOutput: this.config.shell.maxOutput,
      blockedCommands: this.config.shell.blockedCommands,
      blockedPaths: this.config.shell.blockedPaths,
      blockedParams: this.config.shell.blockedParams
    }, this.log);

    this.log.info(`Exec plugin loaded, python executable: ${this.config.python.executable}`);
  },

  tools: [
    {
      name: 'python_exec',
      description: '用系统 Python 执行代码。',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Python 代码。'
          }
        },
        required: ['code']
      },
      async execute(params) {
        const { code } = params;
        plugin.log.debug('Executing python');
        return await plugin.pythonRunner.execute(code);
      }
    },
    {
      name: 'shell_exec',
      description: '执行 Shell 命令；危险命令会被拦截。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Shell 命令。'
          }
        },
        required: ['command']
      },
      async execute(params) {
        const { command } = params;
        plugin.log.debug(`Executing shell: ${command}`);
        return await plugin.shellRunner.execute(command);
      }
    }
  ]
};

export default plugin;
