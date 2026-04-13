import { logger } from '@/platform/observability/logger.js';
import { roleManager, DEFAULT_ROLE_ID } from './role-manager.js';
import { toolRegistry } from '@/platform/tools/registry.js';
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

  private buildCapabilitiesSection(roleId: string): { tools: string } {
    const roleConfig = roleManager.getRoleConfig(roleId);
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

    return { tools };
  }

  buildSystemPrompt(options: SystemPromptBuildOptions): string {
    const { roleId } = options;
    const actualRoleId = roleId || DEFAULT_ROLE_ID;

    const roleConfig = roleManager.getRoleConfig(actualRoleId);
    const basePrompt = roleConfig.system_prompt || '你是一个有帮助的AI助手。';

    const vars = this.getSystemVariables();
    let prompt = this.replaceVariables(basePrompt, vars);

    const { tools } = this.buildCapabilitiesSection(actualRoleId);

    const systemInfoLines: string[] = [];
    systemInfoLines.push('');
    systemInfoLines.push('【系统信息】');
    systemInfoLines.push(`- 日期: ${vars.date}`);
    systemInfoLines.push(`- 操作系统: ${vars.os}`);
    systemInfoLines.push(`- 系统语言: ${vars.systemLang}`);

    const systemInfo = systemInfoLines.join('\n');
    const capabilities = tools;

    prompt = prompt + '\n' + systemInfo + capabilities;

    logger.debug(
      {
        roleId: actualRoleId,
        promptLength: prompt.length,
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
