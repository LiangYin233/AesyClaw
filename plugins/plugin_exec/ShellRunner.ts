import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(execCallback);

export class ShellRunner {
  options;
  log;
  blockedCommands;
  blockedPaths;
  blockedParams;
  timeout;
  maxOutput;

  constructor(options, logger) {
    this.options = options;
    this.log = logger;
    this.blockedCommands = options.blockedCommands || [];
    this.blockedPaths = options.blockedPaths || [];
    this.blockedParams = options.blockedParams || [];
    this.timeout = options.timeout || 30000;
    this.maxOutput = options.maxOutput || 10000;
  }

  checkBlacklist(command) {
    const cmdLower = command.toLowerCase().trim();

    for (const blocked of this.blockedCommands) {
      const blockedLower = blocked.toLowerCase();
      if (cmdLower === blockedLower || cmdLower.startsWith(blockedLower + ' ')) {
        return { blocked: true, reason: `Command blocked: ${blocked}` };
      }
    }

    for (const param of this.blockedParams) {
      if (cmdLower.includes(param.toLowerCase())) {
        return { blocked: true, reason: `Dangerous parameter blocked: ${param}` };
      }
    }

    for (const path of this.blockedPaths) {
      if (cmdLower.includes(path.toLowerCase())) {
        return { blocked: true, reason: `Protected path blocked: ${path}` };
      }
    }

    return { blocked: false };
  }

  truncateOutput(output) {
    if (!output) return '';
    if (output.length <= this.maxOutput) return output;
    return output.substring(0, this.maxOutput) + `\n[输出已截断，原始长度: ${output.length} 字符]`;
  }

  async execute(command) {
    const blacklistCheck = this.checkBlacklist(command);
    if (blacklistCheck.blocked) {
      return `错误: ${blacklistCheck.reason}`;
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024
      });

      return this.truncateOutput(stderr ? `[stderr]\n${stderr}\n[stdout]\n${stdout}` : stdout);
    } catch (error) {
      return `命令执行错误: ${error.message}`;
    }
  }
}

export default ShellRunner;
