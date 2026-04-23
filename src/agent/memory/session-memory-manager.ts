import type { ToolCatalog } from '@/platform/tools/registry.js';
import { SessionMemoryConfig, createSessionMemoryConfig } from './types.js';
import type { RoleManager } from '@/features/roles/role-manager.js';
import type { SystemPromptManager } from '@/features/roles/system-prompt-manager.js';
import { DEFAULT_ROLE_ID } from '@/features/roles/types.js';
import { logger } from '@/platform/observability/logger.js';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

type SessionPromptBuilder = Pick<SystemPromptManager, 'buildSystemPrompt'>;
type SessionRoleStore = Pick<
    RoleManager,
    'getRole' | 'getRoleConfig' | 'getAllRoles' | 'getAllowedTools'
>;

export interface SessionMemoryManagerDependencies {
    systemPromptBuilder: SessionPromptBuilder;
    roleManager?: SessionRoleStore;
    toolCatalog: ToolCatalog;
}

export class SessionMemoryManager {
    readonly chatId: string;
    private messages: AgentMessage[] = [];
    private systemPrompt?: string;
    private activeRoleId: string = DEFAULT_ROLE_ID;
    private readonly config: SessionMemoryConfig;
    private readonly deps: SessionMemoryManagerDependencies;

    constructor(
        chatId: string,
        config: Partial<SessionMemoryConfig> | undefined,
        deps: SessionMemoryManagerDependencies,
    ) {
        if (!deps.systemPromptBuilder) {
            throw new Error('SessionMemoryManager requires systemPromptBuilder dependency');
        }

        this.chatId = chatId;
        this.config = createSessionMemoryConfig(config);
        this.deps = deps;

        logger.info(
            {
                chatId: this.chatId,
                maxTokens: this.config.maxContextTokens,
                compressionThreshold: this.config.compressionThreshold,
            },
            'SessionMemoryManager initialized with pi-agent-core-backed compression',
        );
    }

    getMessages(): ReadonlyArray<AgentMessage> {
        return this.messages;
    }

    setSystemPrompt(prompt: string): void {
        this.systemPrompt = prompt;
    }

    getSystemPrompt(): string | undefined {
        return this.systemPrompt;
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
            {
                chatId: this.chatId,
                previousRoleId,
                newRoleId: roleId,
                roleName: role.name,
            },
            'Role switched',
        );

        return true;
    }

    async rebuildSystemContext(): Promise<void> {
        const systemPrompt = this.deps.systemPromptBuilder.buildSystemPrompt({
            roleId: this.activeRoleId,
            chatId: this.chatId,
        });

        this.systemPrompt = systemPrompt;
    }

    async switchRole(roleId: string): Promise<{ success: boolean; message: string }> {
        if (!this.deps.roleManager) {
            return { success: false, message: 'RoleManager not available' };
        }

        const role = this.deps.roleManager.getRole(roleId);
        if (!role) {
            const roleNames = this.deps.roleManager
                .getAllRoles()
                .map((item) => item.name)
                .join(', ');
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
        const allowedTools = this.deps.roleManager.getAllowedTools(
            roleId,
            this.deps.toolCatalog.getAllToolDefinitions().map((tool) => tool.name),
        );
        const allowedToolsText = allowedTools.length > 0 ? allowedTools.join(', ') : '无';

        return {
            success: true,
            message: `已成功切换至角色：${roleConfig.name}\n可用工具: ${allowedToolsText}`,
        };
    }

    getRoleInfo(): { roleId: string; roleName: string; allowedTools: string[] } {
        if (!this.deps.roleManager) {
            return {
                roleId: this.activeRoleId,
                roleName: 'default',
                allowedTools: [],
            };
        }

        const roleConfig = this.deps.roleManager.getRoleConfig(this.activeRoleId);
        return {
            roleId: this.activeRoleId,
            roleName: roleConfig.name,
            allowedTools: this.deps.roleManager.getAllowedTools(
                this.activeRoleId,
                this.deps.toolCatalog.getAllToolDefinitions().map((tool) => tool.name),
            ),
        };
    }

    hasMessages(): boolean {
        return this.messages.length > 0;
    }

    importMemory(messages: AgentMessage[]): void {
        this.messages = [...messages];
        logger.debug(
            { chatId: this.chatId, importedMessages: this.messages.length },
            'Session memory synced',
        );
    }
}
