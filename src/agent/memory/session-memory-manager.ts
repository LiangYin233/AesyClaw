import { StandardMessage, MessageRole } from '@/platform/llm/types.js';
import { MemoryConfig, createMemoryConfig } from './types.js';
import type { IRoleManager } from '@/contracts/role-manager.js';
import type { ISystemPromptBuilder } from '@/contracts/system-prompt-builder.js';
import { DEFAULT_ROLE_ID } from '@/features/roles/types.js';
import { logger } from '@/platform/observability/logger.js';

export interface SessionMemoryManagerDependencies {
  systemPromptBuilder: ISystemPromptBuilder;
  roleManager?: IRoleManager;
}

export class SessionMemoryManager {
  readonly chatId: string;
  private messages: StandardMessage[] = [];
  private activeRoleId: string = DEFAULT_ROLE_ID;
  private readonly config: MemoryConfig;
  private readonly deps: SessionMemoryManagerDependencies;

  constructor(
    chatId: string,
    config: Partial<MemoryConfig> | undefined,
    deps: SessionMemoryManagerDependencies
  ) {
    if (!deps.systemPromptBuilder) {
      throw new Error('SessionMemoryManager requires systemPromptBuilder dependency');
    }

    this.chatId = chatId;
    this.config = createMemoryConfig(config);
    this.deps = deps;

    logger.info(
      {
        chatId: this.chatId,
        maxTokens: this.config.maxContextTokens,
        compressionThreshold: this.config.compressionThreshold,
      },
      'SessionMemoryManager initialized with aesyiu-backed compression'
    );
  }

  getMessages(): ReadonlyArray<StandardMessage> {
    return this.messages;
  }

  getActiveRoleId(): string {
    return this.activeRoleId;
  }

  setActiveRole(roleId: string): boolean {
    if (!this.deps.roleManager) {
      logger.warn({ chatId: this.chatId, roleId }, 'RoleManager not available');
      return false;
    }

    const role = this.deps.roleManager.getRole(roleId);
    if (!role) {
      logger.warn({ chatId: this.chatId, roleId }, 'Attempted to switch to missing role');
      return false;
    }

    const previousRoleId = this.activeRoleId;
    this.activeRoleId = roleId;

    logger.info(
      { chatId: this.chatId, previousRoleId, newRoleId: roleId, roleName: role.name },
      'Role switched'
    );

    return true;
  }

  async rebuildSystemContext(): Promise<void> {
    const systemPrompt = this.deps.systemPromptBuilder.buildSystemPrompt({
      roleId: this.activeRoleId,
      chatId: this.chatId,
    });

    if (this.messages.length > 0 && this.messages[0].role === MessageRole.System) {
      this.messages[0] = {
        role: MessageRole.System,
        content: systemPrompt,
      };
      return;
    }

    this.messages.unshift({
      role: MessageRole.System,
      content: systemPrompt,
    });
  }

  async switchRole(roleId: string): Promise<{ success: boolean; message: string }> {
    if (!this.deps.roleManager) {
      return { success: false, message: 'RoleManager not available' };
    }

    const role = this.deps.roleManager.getRole(roleId);
    if (!role) {
      const roleNames = this.deps.roleManager.getAllRoles().map(item => item.name).join(', ');
      return {
        success: false,
        message: `角色 "${roleId}" 不存在。可用角色: ${roleNames}`,
      };
    }

    if (!this.setActiveRole(roleId)) {
      return { success: false, message: `切换到角色 "${roleId}" 失败` };
    }

    await this.rebuildSystemContext();

    const roleConfig = this.deps.roleManager.getRoleConfig(roleId);
    const allowedTools = roleConfig.allowed_tools.includes('*')
      ? '所有工具'
      : roleConfig.allowed_tools.join(', ');

    return {
      success: true,
      message: `已成功切换至角色：${roleConfig.name}\n可用工具: ${allowedTools}`,
    };
  }

  getRoleInfo(): { roleId: string; roleName: string; allowedTools: string[] } {
    if (!this.deps.roleManager) {
      return { roleId: this.activeRoleId, roleName: 'default', allowedTools: [] };
    }

    const roleConfig = this.deps.roleManager.getRoleConfig(this.activeRoleId);
    return {
      roleId: this.activeRoleId,
      roleName: roleConfig.name,
      allowedTools: roleConfig.allowed_tools,
    };
  }

  async clear(): Promise<void> {
    this.messages = [];
    this.activeRoleId = DEFAULT_ROLE_ID;

    try {
      await this.rebuildSystemContext();
    } catch (error) {
      logger.error({ chatId: this.chatId, error }, 'Failed to rebuild system context');
    }

    logger.debug({ chatId: this.chatId }, 'Session memory cleared');
  }

  hasMessages(): boolean {
    return this.messages.length > 0;
  }

  importMemory(messages: StandardMessage[]): void {
    this.messages = [...messages];
    logger.debug({ chatId: this.chatId, importedMessages: this.messages.length }, 'Session memory synced');
  }
}
