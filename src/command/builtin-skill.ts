import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import { defineCommand } from '@aesyclaw/command/command-builder';
import type { Message } from '@aesyclaw/core/types';
import type { BuiltinCommandDependencies } from './builtin-types';

export function registerSkillBuiltinCommands(
  registry: CommandRegistry,
  deps: BuiltinCommandDependencies,
): void {
  registry.register(defineCommand({
    name: 'reload',
    namespace: 'skill',
    description: '重新加载所有技能',
    scope: 'system',
    allowDuringAgentProcessing: false,
    execute: async (): Promise<Message> => {
      try {
        await deps.skillManager.reload();
        return { components: [{ type: 'Plain', text: '技能已重新加载。' }] };
      } catch (err) {
        return {
          components: [
            {
              type: 'Plain',
              text: `重新加载技能失败：${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  }));
}
