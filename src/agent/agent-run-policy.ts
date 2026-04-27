import type { ConfigManager } from '../core/config/config-manager';
import type { RoleConfig } from '../core/types';
import type { Agent, AgentMessage } from './agent-types';
import type { LlmAdapter } from './llm-adapter';
import type { MemoryManager } from './memory-manager';

export interface AgentRunOptions {
  maxSteps?: number;
}

export interface AgentRunPolicyDependencies {
  configManager: ConfigManager;
  llmAdapter: LlmAdapter;
}

export class AgentRunPolicy {
  constructor(private readonly deps: AgentRunPolicyDependencies) {}

  async loadHistoryForTurn(memory: MemoryManager, role: RoleConfig): Promise<AgentMessage[]> {
    let history = await memory.loadHistory();
    if (typeof memory.shouldCompact === 'function' && memory.shouldCompact(history)) {
      await memory.compact(this.deps.llmAdapter, role.model);
      history = await memory.loadHistory();
    }
    return history;
  }

  async prompt(agent: Agent, content: string, runOptions: AgentRunOptions = {}): Promise<void> {
    let unsubscribe: (() => void) | undefined;
    let stepCount = 0;
    const maxSteps = this.resolveMaxSteps(runOptions);

    if (maxSteps && typeof agent.subscribe === 'function') {
      unsubscribe = agent.subscribe((event) => {
        if (isTurnStartEvent(event)) {
          stepCount++;
          if (stepCount > maxSteps) {
            agent.abort();
          }
        }
      });
    }

    try {
      await agent.prompt(content);
      await agent.waitForIdle();
    } finally {
      unsubscribe?.();
    }
  }

  private resolveMaxSteps(runOptions: AgentRunOptions): number | undefined {
    const configured = runOptions.maxSteps ?? this.deps.configManager.get('agent').maxSteps;
    return typeof configured === 'number' && Number.isFinite(configured) && configured > 0
      ? configured
      : undefined;
  }
}

function isTurnStartEvent(event: unknown): event is { type: 'turn_start' } {
  return (
    event !== null &&
    typeof event === 'object' &&
    (event as { type?: unknown }).type === 'turn_start'
  );
}
