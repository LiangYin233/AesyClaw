import type { ResolvedSessionContext } from '../session/SessionResolver.js';

export interface ToolCallLoopPort {
  run(context: ResolvedSessionContext): Promise<string | undefined>;
}

export interface TurnExecutorDeps {
  toolCallLoop: ToolCallLoopPort;
}

export class TurnExecutor {
  constructor(private readonly deps: TurnExecutorDeps) {}

  async execute(context: ResolvedSessionContext): Promise<string | undefined> {
    return this.deps.toolCallLoop.run(context);
  }
}
