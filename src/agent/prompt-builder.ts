/**
 * PromptBuilder — constructs system prompts for agent sessions.
 *
 * This is a thin wrapper around RoleManager.buildSystemPrompt(), which
 * already handles template variable replacement, tool listing, skill
 * sections, and role descriptions. PromptBuilder adds the responsibility
 * of resolving which tools and skills are available for a given role.
 *
 */

import type { RoleManager } from '../role/role-manager';
import type { SkillManager } from '../skill/skill-manager';
import type { ToolRegistry, AesyClawTool, ToolExecutionContext } from '../tool/tool-registry';
import type { RoleConfig, Skill } from '../core/types';
import type { AgentTool } from './agent-types';
import type { HookDispatcher } from '../pipeline/hook-dispatcher';
import { filterToolsByRole } from '../tool/tool-registry';

// ─── PromptBuilder ──────────────────────────────────────────────

/**
 * Dependencies injected into PromptBuilder on construction.
 */
export interface PromptBuilderDependencies {
  roleManager: RoleManager;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  hookDispatcher: HookDispatcher;
}

export class PromptBuilder {
  private roleManager: RoleManager;
  private skillManager: SkillManager;
  private toolRegistry: ToolRegistry;
  private hookDispatcher: HookDispatcher;

  constructor(deps: PromptBuilderDependencies) {
    this.roleManager = deps.roleManager;
    this.skillManager = deps.skillManager;
    this.toolRegistry = deps.toolRegistry;
    this.hookDispatcher = deps.hookDispatcher;
  }

  /**
   * Build the full system prompt for a role.
   *
   * This method:
   * 1. Resolves the available tools for the role using ToolRegistry
   * 2. Gets the skills applicable to the role using SkillManager
   * 3. Gets all enabled roles for the role list section
   * 4. Delegates to RoleManager.buildSystemPrompt for the actual construction
   *
   * @param role - The role configuration to build the prompt for
   * @param executionContext - Optional context for tool execution
   * @returns The complete system prompt string and the resolved AgentTools
   */
  buildSystemPrompt(
    role: RoleConfig,
    executionContext?: Partial<ToolExecutionContext>,
  ): { prompt: string; tools: AgentTool[] } {
    // Get all enabled roles for the role list section
    const allRoles = this.roleManager.getEnabledRoles();

    // Get role-available skills
    const skills: Skill[] = this.skillManager.getSkillsForRole(role);

    // Get filtered AesyClawTools for the prompt (buildSystemPrompt needs AesyClawTool[])
    const allTools = this.toolRegistry.getAll();
    const filteredInternalTools: AesyClawTool[] = filterToolsByRole(allTools, role);

    // Resolve AgentTools for the agent (includes hook dispatching)
    const agentTools: AgentTool[] = this.toolRegistry.resolveForRole(
      role,
      this.hookDispatcher,
      executionContext ?? {},
    );

    // Build system prompt using RoleManager (needs AesyClawTool[])
    const prompt = this.roleManager.buildSystemPrompt(
      role,
      filteredInternalTools,
      skills,
      allRoles,
    );

    return { prompt, tools: agentTools };
  }
}
