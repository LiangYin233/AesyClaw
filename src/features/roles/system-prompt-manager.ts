import { logger } from '../../platform/observability/logger.js';
import { roleManager, DEFAULT_ROLE_ID } from './role-manager.js';
import { skillManager } from '../skills/skill-manager.js';
import { ToolRegistry } from '../../platform/tools/registry.js';
import type { SystemPromptBuildOptions, SystemVariables } from './system-prompt-types.js';

const OS_NAMES: Record<string, string> = {
  'win32': 'Windows',
  'darwin': 'macOS',
  'linux': 'Linux',
  'freebsd': 'FreeBSD',
};

export class SystemPromptManager {
  private static instance: SystemPromptManager;

  private constructor() {
    logger.info('SystemPromptManager singleton initialized');
  }

  static getInstance(): SystemPromptManager {
    if (!SystemPromptManager.instance) {
      SystemPromptManager.instance = new SystemPromptManager();
    }
    return SystemPromptManager.instance;
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

  private buildCapabilitiesSection(): { skills: string; tools: string } {
    const lines: string[] = [];

    if (skillManager.isInitialized()) {
      const allSkillNames = skillManager.getSkillNames();
      if (allSkillNames.length > 0) {
        lines.push('');
        lines.push('【可用技能】');
        for (const skillName of allSkillNames) {
          const route = skillManager.getSkillRoute(skillName);
          if (route) {
            lines.push(`- ${skillName}: ${route.shortDescription}`);
          }
        }
      }
    }

    const skills = lines.join('\n');

    const toolLines: string[] = [];
    try {
      const toolRegistry = ToolRegistry.getInstance();
      const allTools = toolRegistry.getAllToolDefinitions();

      if (allTools.length > 0) {
        toolLines.push('');
        toolLines.push('【可用工具】');
        for (const tool of allTools) {
          const description = tool.description?.split('\n')[0] || '无描述';
          toolLines.push(`- ${tool.name}: ${description}`);
        }
      }
    } catch (error) {
      logger.debug({ error }, 'Failed to get tool definitions');
    }

    const tools = toolLines.join('\n');

    return { skills, tools };
  }

  buildSystemPrompt(options: SystemPromptBuildOptions): string {
    const { roleId, chatId, senderId } = options;
    const actualRoleId = roleId || DEFAULT_ROLE_ID;

    const roleConfig = roleManager.getRoleConfig(actualRoleId);
    const basePrompt = roleConfig.system_prompt || '你是一个有帮助的AI助手。';

    const vars = this.getSystemVariables();
    let prompt = this.replaceVariables(basePrompt, vars);

    const { skills, tools } = this.buildCapabilitiesSection();

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

export const systemPromptManager = SystemPromptManager.getInstance();
