import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import { registerGeneralBuiltinCommands } from './builtin-general';
import { registerPluginBuiltinCommands } from './builtin-plugin';
import { registerRoleBuiltinCommands } from './builtin-role';
import { registerSessionBuiltinCommands } from './builtin-session';
import { registerSkillBuiltinCommands } from './builtin-skill';
import type { BuiltinCommandDependencies } from './builtin-types';
export type { BuiltinCommandDependencies } from './builtin-types';

/**
 * 向命令注册表中注册所有内置命令。
 * @param registry - 命令注册表
 * @param deps - 内置命令所需的依赖集合
 */
export function registerBuiltinCommands(
  registry: CommandRegistry,
  deps: BuiltinCommandDependencies,
): void {
  registerGeneralBuiltinCommands(registry, deps);
  registerSessionBuiltinCommands(registry, deps);
  registerRoleBuiltinCommands(registry, deps);
  registerPluginBuiltinCommands(registry, deps);
  registerSkillBuiltinCommands(registry, deps);
}
