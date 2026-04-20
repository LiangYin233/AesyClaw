import type { CommandResult } from '@/contracts/commands.js';

export function createMissingArgumentResult(message: string, usage: string): CommandResult {
  return {
    success: false,
    message: `${message}\n\n用法: ${usage}`,
  };
}

export function createUnknownSubcommandResult(subCommand: string | undefined, availableLines: string[]): CommandResult {
  return {
    success: false,
    message: `未知子命令: ${subCommand || '(无)'}\n\n可用子命令:\n${availableLines.join('\n')}`,
  };
}
