import type { ConfigManager } from '../core/config/config-manager';
import type { RoleConfig } from '../core/types';
import type { Agent, AgentMessage } from './agent-types';
import type { LlmAdapter } from './llm-adapter';
import type { MemoryManager } from './memory-manager';

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

  async prompt(agent: Agent, content: string): Promise<void> {
    await agent.prompt(content);
    await agent.waitForIdle();
  }
}
