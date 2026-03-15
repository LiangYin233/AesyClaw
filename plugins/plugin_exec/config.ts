import { platform } from 'os';

export interface PythonExecOptions {
  executable: string;
  timeout: number;
  maxOutput: number;
}

export interface ShellExecOptions {
  timeout: number;
  maxOutput: number;
}

export interface ExecPluginConfig {
  python: PythonExecOptions;
  shell: ShellExecOptions;
}

export interface ExecPluginOptions {
  python?: Partial<PythonExecOptions>;
  shell?: Partial<ShellExecOptions>;
}

const DEFAULT_CONFIG: ExecPluginConfig = {
  python: {
    executable: platform() === 'win32' ? 'python' : 'python3',
    timeout: 30000,
    maxOutput: 10000
  },
  shell: {
    timeout: 30000,
    maxOutput: 10000
  }
};

export const CONFIG = {
  DEFAULT_CONFIG
};

export function loadConfig(options?: ExecPluginOptions): ExecPluginConfig {
  const config: ExecPluginConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as ExecPluginConfig;

  if (!options) {
    return config;
  }

  if (options.python) {
    if (typeof options.python.executable === 'string') {
      config.python.executable = options.python.executable;
    }
    if (typeof options.python.timeout === 'number') {
      config.python.timeout = options.python.timeout;
    }
    if (typeof options.python.maxOutput === 'number') {
      config.python.maxOutput = options.python.maxOutput;
    }
  }

  if (options.shell) {
    if (typeof options.shell.timeout === 'number') {
      config.shell.timeout = options.shell.timeout;
    }
    if (typeof options.shell.maxOutput === 'number') {
      config.shell.maxOutput = options.shell.maxOutput;
    }
  }

  return config;
}

export default { CONFIG, loadConfig };
