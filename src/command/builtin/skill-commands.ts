import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';

export function createSkillReloadCommand(skillManager: SkillManager): CommandDefinition {
  return {
    name: 'reload',
    namespace: 'skill',
    description: '重新加载所有技能文件',
    usage: '/skill reload',
    scope: 'system',
    execute: async (_args: string[], _context: CommandContext): Promise<string> => {
      await skillManager.reload();
      const count = skillManager.getAllSkills().length;
      return `技能已重新加载。当前共有 ${count} 个技能。`;
    },
  };
}
