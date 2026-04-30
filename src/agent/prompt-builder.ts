/**
 * PromptBuilder — constructs system prompts for agent sessions.
 *
 * PromptBuilder owns prompt assembly for agent sessions: it resolves the
 * role-visible tools, skills, and available-role metadata, then assembles
 * the final system prompt text.
 *
 */

import type { RoleManager } from '../role/role-manager';
import type { SkillManager } from '../skill/skill-manager';
import type { AesyClawTool, ToolRegistry, ToolExecutionContext } from '../tool/tool-registry';
import type { RoleConfig, Skill } from '../core/types';
import type { AgentTool } from './agent-types';
import type { HookDispatcher } from '../pipeline/hook-dispatcher';
import { buildSkillPromptSection } from '../skill/skill-prompt';

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
   * 4. Assembles the final system prompt
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

    const resolvedTools = this.toolRegistry.resolveForRoleWithDefinitions(
      role,
      this.hookDispatcher,
      executionContext ?? {},
    );

    const prompt = this.assemblePrompt(role, resolvedTools.tools, skills, allRoles);

    return { prompt, tools: resolvedTools.agentTools };
  }

  private assemblePrompt(
    role: RoleConfig,
    availableTools: AesyClawTool[],
    skills: Skill[],
    allRoles: RoleConfig[],
  ): string {
    let prompt = this.replaceTemplateVariables(role.systemPrompt);

    if (availableTools.length > 0) {
      prompt += `\n\n${this.buildToolSection(availableTools)}`;
    }

    if (skills.length > 0) {
      prompt += `\n\n${buildSkillPromptSection(skills)}`;
    }

    if (allRoles.length > 0) {
      const roleLines = allRoles.map((r) => `- **${r.id}**: ${r.name} — ${r.description}`);
      prompt += `\n\n## Available Roles\n${roleLines.join('\n')}`;
    }

    return prompt;
  }

  private replaceTemplateVariables(template: string): string {
    return template
      .replace(/\{\{date}}/g, new Date().toISOString().split('T')[0] ?? new Date().toISOString())
      .replace(/\{\{os}}/g, process.platform)
      .replace(/\{\{systemLang}}/g, process.env.LANG ?? 'unknown');
  }

  private buildToolSection(tools: AesyClawTool[]): string {
    const toolLines = tools.map((tool) => `- **${tool.name}**: ${tool.description}`);
    return `## Available Tools\n${toolLines.join('\n')}`;
  }
}
