import { platform } from 'os';
import { definePlugin } from '../../src/plugins/index.ts';
import { preview } from '../../src/observability/index.ts';
import { loadConfig } from './config.ts';
import type { ExecPluginOptions } from './config.ts';
import { PythonRunner } from './PythonRunner.ts';
import { ShellRunner } from './ShellRunner.ts';

export default definePlugin<ExecPluginOptions>({
  name: 'plugin_exec',
  version: '1.0.0',
  description: '执行 Python 或 Shell。',
  toolsCount: 2,
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
  setup(ctx) {
    const log = ctx.logger.child('exec');
    const config = loadConfig(ctx.options);
    const pythonRunner = new PythonRunner({
      executable: config.python.executable,
      timeout: config.python.timeout,
      maxOutput: config.python.maxOutput
    }, log);
    const shellRunner = new ShellRunner({
      timeout: config.shell.timeout,
      maxOutput: config.shell.maxOutput,
      blockedCommands: config.shell.blockedCommands,
      blockedPaths: config.shell.blockedPaths,
      blockedParams: config.shell.blockedParams
    }, log);

    log.info('Exec plugin loaded', {
      pythonExecutable: config.python.executable,
      pythonTimeoutMs: config.python.timeout,
      shellTimeoutMs: config.shell.timeout
    });

    ctx.tools.register({
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
        log.info('Python execution started');
        return pythonRunner.execute(code);
      }
    });

    ctx.tools.register({
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
        log.info('Shell execution started', { commandPreview: preview(command) });
        return shellRunner.execute(command);
      }
    });
  }
});
