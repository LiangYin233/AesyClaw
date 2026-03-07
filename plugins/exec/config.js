import { platform } from 'os';

const DEFAULT_BLOCKED_COMMANDS = [
  'rm', 'rmdir', 'unlink', 'del', 'erase', 'Remove-Item',
  'format', 'mkfs', 'diskpart',
  'dd', 'fdisk', 'parted', 'sfdisk',
  'shutdown', 'reboot', 'init', 'halt',
  'kill', 'killall', 'pkill',
  'systemctl', 'service',
  'iptables', 'ufw',
  'chmod', 'chown',
  'userdel', 'usermod', 'net user',
  'netsh interface', 'ipconfig /release',
  'reg', 'regedit'
];

const DEFAULT_BLOCKED_PATHS = [
  '/', '/bin', '/sbin', '/usr', '/etc', '/boot', '/dev', '/var',
  'C:\\', 'C:/',
  'C:\\Windows', 'C:\\System32', 'C:\\Program Files',
  '/System', '/boot', '/proc'
];

const DEFAULT_BLOCKED_PARAMS = [
  '-rf', '-r -f', '-fr', '/s /q', '/f /s', '-Force', '--force', '-y', '-rf /*'
];

const DEFAULT_CONFIG = {
  python: {
    executable: platform() === 'win32' ? 'python' : 'python3',
    timeout: 30000,
    maxOutput: 10000
  },
  shell: {
    timeout: 30000,
    maxOutput: 10000,
    blockedCommands: DEFAULT_BLOCKED_COMMANDS,
    blockedPaths: DEFAULT_BLOCKED_PATHS,
    blockedParams: DEFAULT_BLOCKED_PARAMS
  }
};

export const CONFIG = {
  DEFAULT_BLOCKED_COMMANDS,
  DEFAULT_BLOCKED_PATHS,
  DEFAULT_BLOCKED_PARAMS,
  DEFAULT_CONFIG
};

export function loadConfig(options) {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

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
    if (Array.isArray(options.shell.blockedCommands)) {
      config.shell.blockedCommands = options.shell.blockedCommands;
    }
    if (Array.isArray(options.shell.blockedPaths)) {
      config.shell.blockedPaths = options.shell.blockedPaths;
    }
    if (Array.isArray(options.shell.blockedParams)) {
      config.shell.blockedParams = options.shell.blockedParams;
    }
  }

  return config;
}

export default { CONFIG, loadConfig };
