import { platform } from 'os';
import type { ToolContext } from '../../src/platform/tools/index.ts';
import { loadConfig } from './config.ts';
import { PythonRunner } from './PythonRunner.ts';
import { ShellRunner } from './ShellRunner.ts';

export default {
  name: 'plugin_exec',
  version: '1.0.0',
  author: 'aesyclaw_official',
  description: '执行 Python 或 Shell。',
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
   
  setup(ctx: any) {
    const log = ctx.logger.child('exec');
    // 获取配置的工具函数
    const getPythonOptions = () => {
      const opts = ctx.settings;
      return loadConfig(opts).python;
    };
    const getShellOptions = () => {
      const opts = ctx.settings;
      return loadConfig(opts).shell;
    };
    const pythonRunner = new PythonRunner(getPythonOptions, log);
    const shellRunner = new ShellRunner(getShellOptions, log);

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
};
