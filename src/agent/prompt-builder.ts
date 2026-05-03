/**
 * PromptBuilder — 为 Agent 会话构建系统提示词。
 *
 * PromptBuilder 负责 Agent 会话的提示词组装：它解析
 * 角色可见的工具、技能和可用角色元数据，然后组装
 * 最终的系统提示词文本。
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
 * 构造时注入 PromptBuilder 的依赖。
 */
export type PromptBuilderDependencies = {
  roleManager: RoleManager;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  toolHookDispatcher: HookDispatcher;
}

export class PromptBuilder {
  private roleManager: RoleManager;
  private skillManager: SkillManager;
  private toolRegistry: ToolRegistry;
  private toolHookDispatcher: HookDispatcher;

  constructor(deps: PromptBuilderDependencies) {
    this.roleManager = deps.roleManager;
    this.skillManager = deps.skillManager;
    this.toolRegistry = deps.toolRegistry;
    this.toolHookDispatcher = deps.toolHookDispatcher;
  }

  /**
   * 为角色构建完整的系统提示词。
   *
   * 此方法：
   * 1. 使用 ToolRegistry 解析角色的可用工具
   * 2. 使用 SkillManager 获取角色适用的技能
   * 3. 获取角色列表部分的所有已启用角色
   * 4. 组装最终的系统提示词
   *
   * @param role - 要为其构建提示词的角色配置
   * @param executionContext - 工具执行的可选上下文
   * @returns 完整的系统提示词字符串和解析后的 AgentTools
   */
  buildSystemPrompt(
    role: RoleConfig,
    executionContext?: Partial<ToolExecutionContext>,
  ): { prompt: string; tools: AgentTool[] } {
    // 获取角色列表部分的所有已启用角色
    const allRoles = this.roleManager.getEnabledRoles();

    // 获取角色可用的技能
    const skills: Skill[] = this.skillManager.getSkillsForRole(role);

    const resolvedTools = this.toolRegistry.resolveForRole(
      role,
      this.toolHookDispatcher,
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
      .replace(/\{\{systemLang}}/g, process.env['LANG'] ?? 'unknown');
  }

  private buildToolSection(tools: AesyClawTool[]): string {
    const toolLines = tools.map((tool) => `- **${tool.name}**: ${tool.description}`);
    return `## Available Tools\n${toolLines.join('\n')}`;
  }
}
