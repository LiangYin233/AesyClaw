import type { CommandResult } from '@/contracts/commands.js';

interface SubcommandContext {
  args: readonly string[];
}

type SubcommandHandler<TContext extends SubcommandContext> = (
  _ctx: TContext
) => CommandResult | Promise<CommandResult>;

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

export async function dispatchSubcommand<TContext extends SubcommandContext>(
  ctx: TContext,
  availableLines: string[],
  handlers: Record<string, SubcommandHandler<TContext>>
): Promise<CommandResult> {
  const subCommand = ctx.args[0]?.toLowerCase();
  const handler = subCommand ? handlers[subCommand] : undefined;

  if (!handler) {
    return createUnknownSubcommandResult(subCommand, availableLines);
  }

  return await handler(ctx);
}
