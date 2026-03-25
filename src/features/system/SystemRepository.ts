import type { AgentRuntime } from '../../agent/index.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';

export class SystemRepository {
  constructor(
    private readonly agentRuntime: Pick<AgentRuntime, 'isRunning'>,
    private readonly sessionManager: Pick<SessionManager, 'count'>,
    private readonly toolRegistry?: ToolRegistry
  ) {}

  isAgentRunning(): boolean {
    return this.agentRuntime.isRunning();
  }

  getSessionCount(): number {
    return this.sessionManager.count();
  }

  getToolDefinitions(): ReturnType<ToolRegistry['getDefinitions']> | [] {
    return this.toolRegistry?.getDefinitions() ?? [];
  }
}
