import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { AgentRegistry } from '@aesyclaw/agent/agent-registry';

/**
 * 创建 /skill reload 命令，用于重新加载所有技能文件并刷新 Agent 的 Prompt 缓存。
 * @param skillManager - 技能管理器实例
 * @param agentRegistry - Agent 注册中心，用于刷新 Prompt 缓存
 * @returns 命令定义
 */
export function createSkillReloadCommand(
  skillManager: SkillManager,
  agentRegistry: AgentRegistry,
): CommandDefinition {
  return {
    name: 'reload',
    namespace: 'skill',
    description: '重新加载所有技能文件',
    usage: '/skill reload',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      await skillManager.reload();
      agentRegistry.invalidatePromptCache(context.sessionKey);
      const count = skillManager.getAllSkills().length;
      return `技能已重新加载。当前共有 ${count} 个技能。`;
    },
  };
}
