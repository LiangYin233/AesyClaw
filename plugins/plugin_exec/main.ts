import { platform } from 'os';
import { definePlugin } from '../../src/features/plugins/index.ts';
import type { ToolContext } from '../../src/platform/tools/index.ts';
import { loadConfig } from './config.ts';
import type { ExecPluginOptions } from './config.ts';
import { PythonRunner } from './PythonRunner.ts';
import { ShellRunner } from './ShellRunner.ts';

export default definePlugin<ExecPluginOptions>({
  name: 'plugin_exec',
  version: '1.0.0',
  author: 'aesyclaw_official',
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
      maxOutput: config.shell.maxOutput
    }, log);

    ctx.tools.register({
      name: 'python_exec',
      description: '执行本地 Python 代码。',
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
      async execute(params: Record<string, any>, context?: ToolContext) {
        const { code } = params;
        return pythonRunner.execute(code, context?.workspace, context?.signal);
      }
    });

    ctx.tools.register({
      name: 'shell_exec',
      description: '直接执行本地 Shell 命令。',
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
      async execute(params: Record<string, any>, context?: ToolContext) {
        const { command } = params;
        return shellRunner.execute(command, context?.workspace, context?.signal);
      }
    });
  }
});
