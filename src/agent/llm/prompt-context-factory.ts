import { logger } from '../../platform/observability/logger.js';
import { roleManager, DEFAULT_ROLE_ID } from '../../features/roles/role-manager.js';
import { skillManager } from '../../features/skills/skill-manager.js';
import { systemPromptManager } from '../../features/roles/system-prompt-manager.js';
import {
  PromptContext,
  PromptContextOptions,
  SystemContext,
  SkillInfo,
  PromptMetadata,
} from './prompt-context.js';

export class PromptContextFactory {
  static build(options: PromptContextOptions): PromptContext {
    const {
      chatId,
      senderId,
      traceId,
      roleId,
      messages,
      tools,
      skills,
      maxTokens,
    } = options;

    const actualRoleId = roleId || DEFAULT_ROLE_ID;
    const roleConfig = roleManager.getRoleConfig(actualRoleId);
    const vars = systemPromptManager.getSystemVariables();

    const systemPrompt = systemPromptManager.buildSystemPrompt({
      roleId: actualRoleId,
      chatId,
      senderId,
    });

    const system: SystemContext = {
      roleId: actualRoleId,
      roleName: roleConfig.name,
      systemPrompt,
      variables: vars,
    };

    const metadata: PromptMetadata = {
      chatId,
      senderId,
      traceId,
      roleId: actualRoleId,
      maxTokens,
    };

    const filteredSkills = skills || this.getFilteredSkills(actualRoleId);

    logger.debug(
      {
        chatId,
        roleId: actualRoleId,
        messageCount: messages.length,
        toolCount: tools.length,
        skillCount: filteredSkills.length,
      },
      'PromptContext built'
    );

    return {
      system,
      messages,
      tools,
      skills: filteredSkills,
      metadata,
    };
  }

  private static getFilteredSkills(roleId: string): SkillInfo[] {
    if (!skillManager.isInitialized()) {
      return [];
    }

    const roleConfig = roleManager.getRoleConfig(roleId);
    const allSkillNames = skillManager.getSkillNames();
    const allowedSkills = roleConfig.allowed_skills;

    const filteredNames = allowedSkills.includes('*')
      ? allSkillNames
      : allSkillNames.filter(name => allowedSkills.includes(name));

    const skills: SkillInfo[] = [];
    for (const skillName of filteredNames) {
      const route = skillManager.getSkillRoute(skillName);
      if (route) {
        skills.push({
          name: route.name,
          description: route.shortDescription,
        });
      }
    }

    return skills;
  }
}

export function buildPromptContext(options: PromptContextOptions): PromptContext {
  return PromptContextFactory.build(options);
}
