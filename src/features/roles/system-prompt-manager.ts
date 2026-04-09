import { logger } from '../../platform/observability/logger.js';
import { roleManager, DEFAULT_ROLE_ID } from './role-manager.js';
import { skillManager } from '../skills/skill-manager.js';
import { toolRegistry } from '../../platform/tools/registry.js';
import type { SystemPromptBuildOptions, SystemVariables } from './system-prompt-types.js';

const OS_NAMES: Record<string, string> = {
  'win32': 'Windows',
  'darwin': 'macOS',
  'linux': 'Linux',
  'freebsd': 'FreeBSD',
};

export class SystemPromptManager {
  constructor() {
    logger.info('SystemPromptManager initialized');
  }

  getSystemVariables(): SystemVariables {
    const date = new Date().toISOString().split('T')[0];
    const os = OS_NAMES[process.platform] || process.platform;
    const systemLang = process.env.LANG || process.env.LC_ALL || 'en-US';

    return { date, os, systemLang };
  }

  replaceVariables(template: string, vars: SystemVariables): string {
    return template
      .replace(/\{\{date\}\}/g, vars.date)
      .replace(/\{\{os\}\}/g, vars.os)
      .replace(/\{\{systemLang\}\}/g, vars.systemLang);
  }

  private buildCapabilitiesSection(roleId: string): { skills: string; tools: string } {
    const roleConfig = roleManager.getRoleConfig(roleId);
    const lines: string[] = [];

    if (skillManager.isInitialized()) {
      const allSkillNames = skillManager.getSkillNames();
      const allowedSkills = roleConfig.allowed_skills;

      if (allSkillNames.length > 0) {
        lines.push('');
        lines.push('【可用技能】');

        const filteredSkills = allowedSkills.includes('*')
          ? allSkillNames
          : allSkillNames.filter(name => allowedSkills.includes(name));

        for (const skillName of filteredSkills) {
          const route = skillManager.getSkillRoute(skillName);
          if (route) {
            lines.push(`- ${skillName}: ${route.shortDescription}`);
          }
        }

        if (filteredSkills.length === 0) {
          lines.push('（该角色未配置任何技能）');
        }
      }
    }

    const skills = lines.join('\n');

    const toolLines: string[] = [];
    try {
      const allTools = toolRegistry.getAllToolDefinitions();
      const allowedTools = roleConfig.allowed_tools;

      if (allTools.length > 0) {
        toolLines.push('');
        toolLines.push('【可用工具】');

        const filteredTools = allowedTools.includes('*')
          ? allTools
          : allTools.filter(tool => allowedTools.includes(tool.name));

        for (const tool of filteredTools) {
          const description = tool.description?.split('\n')[0] || '无描述';
          toolLines.push(`- ${tool.name}: ${description}`);
        }

        if (filteredTools.length === 0) {
          toolLines.push('（该角色未配置任何工具）');
        }
      }
    } catch (error) {
      logger.debug({ error }, 'Failed to get tool definitions');
    }

    const tools = toolLines.join('\n');

    return { skills, tools };
  }

  buildSystemPrompt(options: SystemPromptBuildOptions): string {
    const { roleId } = options;
    const actualRoleId = roleId || DEFAULT_ROLE_ID;

    const roleConfig = roleManager.getRoleConfig(actualRoleId);
    const basePrompt = roleConfig.system_prompt || '你是一个有帮助的AI助手。';

    const vars = this.getSystemVariables();
    let prompt = this.replaceVariables(basePrompt, vars);

    const { skills, tools } = this.buildCapabilitiesSection(actualRoleId);

    const systemInfoLines: string[] = [];
    systemInfoLines.push('');
    systemInfoLines.push('【系统信息】');
    systemInfoLines.push(`- 日期: ${vars.date}`);
    systemInfoLines.push(`- 操作系统: ${vars.os}`);
    systemInfoLines.push(`- 系统语言: ${vars.systemLang}`);

    const systemInfo = systemInfoLines.join('\n');
    const capabilities = skills + tools;

    prompt = prompt + '\n' + systemInfo + capabilities;

    logger.debug(
      {
        roleId: actualRoleId,
        promptLength: prompt.length,
        hasSkills: skills.length > 0,
        hasTools: tools.length > 0,
      },
      'System prompt built'
    );

    return prompt;
  }

  buildRoleOnlyPrompt(roleId: string): string {
    const actualRoleId = roleId || DEFAULT_ROLE_ID;
    const roleConfig = roleManager.getRoleConfig(actualRoleId);
    const basePrompt = roleConfig.system_prompt || '你是一个有帮助的AI助手。';
    const vars = this.getSystemVariables();
    return this.replaceVariables(basePrompt, vars);
  }
}

export const systemPromptManager = new SystemPromptManager();
