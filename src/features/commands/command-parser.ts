import { ParsedCommand } from './types.js';

export class CommandParser {
  private static instance: CommandParser;

  private constructor() {}

  static getInstance(): CommandParser {
    if (!CommandParser.instance) {
      CommandParser.instance = new CommandParser();
    }
    return CommandParser.instance;
  }

  parse(input: string): ParsedCommand | null {
    const trimmed = input.trim();

    if (!trimmed.startsWith('/')) {
      return null;
    }

    const withoutSlash = trimmed.slice(1);
    const parts = withoutSlash.split(/\s+/).filter(part => part.length > 0);

    if (parts.length === 0) {
      return null;
    }

    const name = parts[0].toLowerCase();
    const args = parts.slice(1);
    const rawArgs = args.join(' ');

    return {
      name,
      args,
      rawArgs,
    };
  }

  isCommand(input: string): boolean {
    return input.trim().startsWith('/');
  }

  extractQuotedArgs(rawArgs: string): string[] {
    const args: string[] = [];
    const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;

    while ((match = regex.exec(rawArgs)) !== null) {
      args.push(match[1] || match[2] || match[3]);
    }

    return args;
  }
}

export const commandParser = CommandParser.getInstance();
