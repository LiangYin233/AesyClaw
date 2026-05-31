/**
 * agent-factory — Agent 工厂，封装 Agent 创建逻辑。
 */
import { Agent } from './agent';
import type { Session } from '@aesyclaw/session';
import type { LlmAdapter } from './llm/adapter';
import type { RoleManager } from '@aesyclaw/role/manager';
import type { SkillManager } from '@aesyclaw/skill/manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { IHooksBus } from '@aesyclaw/hook';
import type { AgentRegistry } from './registry';

export type AgentFactoryDependencies = {
  llmAdapter: LlmAdapter;
  roleManager: RoleManager;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  hooksBus: IHooksBus;
  compressionThreshold: number;
  registry: AgentRegistry;
};

/**
 * Agent 工厂 — 封装 Agent 创建所需的依赖。
 *
 * 避免在 Pipeline 中传递大量依赖参数。
 */
export class AgentFactory {
  constructor(private deps: AgentFactoryDependencies) {}

  /**
   * 创建 Agent 实例。
   * @param session - 会话实例
   * @param modelId - 模型标识符
   * @returns Agent 实例
   */
  create(session: Session, modelId: string): Agent {
    return new Agent({
      session,
      llmAdapter: this.deps.llmAdapter,
      roleManager: this.deps.roleManager,
      skillManager: this.deps.skillManager,
      toolRegistry: this.deps.toolRegistry,
      hooksBus: this.deps.hooksBus,
      compressionThreshold: this.deps.compressionThreshold,
      registry: this.deps.registry,
      defaultModel: modelId,
    });
  }
}
