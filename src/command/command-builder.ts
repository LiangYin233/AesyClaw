import type { CommandDefinition } from '@aesyclaw/core/types';

/**
 * 定义命令。
 *
 * 相比链式 Builder，直接对象定义更贴近命令本身，减少样板代码，
 * 同时保留必要字段校验，避免注册无效命令。
 */
export function defineCommand(command: CommandDefinition): CommandDefinition {
  validateNonEmpty('命令名称', command.name);
  validateNonEmpty('命令描述', command.description);
  validateNonEmpty('命令作用域', command.scope);

  if (command.namespace !== undefined) {
    validateNonEmpty('命令命名空间', command.namespace);
  }

  return command;
}

function validateNonEmpty(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label}不能为空`);
  }
}
