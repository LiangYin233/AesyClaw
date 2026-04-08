import { MessageRole } from '../llm/types.js';

export class RoleUtils {
  private static readonly LABELS: Record<MessageRole, string> = {
    [MessageRole.System]: '[系统]',
    [MessageRole.User]: '[用户]',
    [MessageRole.Assistant]: '[助手]',
    [MessageRole.Tool]: '[工具]',
  };

  private static readonly DISPLAY_NAMES: Record<MessageRole, string> = {
    [MessageRole.System]: '系统',
    [MessageRole.User]: '用户',
    [MessageRole.Assistant]: '助手',
    [MessageRole.Tool]: '工具',
  };

  private static readonly TOKEN_WEIGHTS: Record<MessageRole, number> = {
    [MessageRole.System]: 5,
    [MessageRole.User]: 3,
    [MessageRole.Assistant]: 3,
    [MessageRole.Tool]: 5,
  };

  static getLabel(role: MessageRole): string {
    return this.LABELS[role];
  }

  static getDisplayName(role: MessageRole): string {
    return this.DISPLAY_NAMES[role];
  }

  static getTokenWeight(role: MessageRole): number {
    return this.TOKEN_WEIGHTS[role];
  }

  static isValidRole(role: string): boolean {
    return Object.values(MessageRole).includes(role as MessageRole);
  }
}
