import { platform } from 'os';
import type { PluginContext } from '../../src/plugins/PluginManager.ts';
import { loadConfig } from './config.ts';
import type { ExecPluginConfig } from './config.ts';
import { PythonRunner } from './PythonRunner.ts';
import { ShellRunner } from './ShellRunner.ts';

interface LoggerLike {
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  preview: (value: unknown, limit?: number) => string;
}

const defaultLogger: LoggerLike = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  preview: (value: unknown, limit: number = 120) => String(value ?? '').slice(0, limit)
};

const plugin: {
  name: string;
  version: string;
  description: string;
  log: LoggerLike;
  config: ExecPluginConfig | null;
  pythonRunner: PythonRunner | null;
  shellRunner: ShellRunner | null;
  defaultConfig: {
    enabled: boolean;
    options: {
      python: { executable: string; timeout: number; maxOutput: number };
      shell: {};
    };
  };
  onLoad(context: PluginContext): Promise<void>;
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, any>;
    execute(params: Record<string, any>): Promise<string>;
  }>;
} = {
  name: 'plugin_exec',
  version: '1.0.0',
  description: '执行 Python 或 Shell。',

  log: defaultLogger,
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

  async onLoad(context: PluginContext) {
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

    this.log.info('Exec plugin loaded', {
      pythonExecutable: this.config.python.executable,
      pythonTimeoutMs: this.config.python.timeout,
      shellTimeoutMs: this.config.shell.timeout
    });
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
      async execute(params: Record<string, any>) {
        const { code } = params;
        if (!plugin.pythonRunner) {
          return 'Python 执行错误: runner 未初始化';
        }
        plugin.log.info('Python execution started');
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
      async execute(params: Record<string, any>) {
        const { command } = params;
        if (!plugin.shellRunner) {
          return 'Shell 执行错误: runner 未初始化';
        }
        plugin.log.info('Shell execution started', { commandPreview: plugin.log.preview(command) });
        return await plugin.shellRunner.execute(command);
      }
    }
  ]
};

export default plugin;
