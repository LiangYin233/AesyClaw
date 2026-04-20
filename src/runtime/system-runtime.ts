/** @file 系统级工具与命令注册运行时
 *
 * 负责在启动时注册系统内置的工具与命令：
 * - 工具：SubAgent 工具、多模态工具（语音转文字/图像理解/发送消息）、Cron 工具
 * - 命令：帮助命令组、插件命令组、会话命令组、角色命令组
 *
 * 所有注册都通过可释放的作用域（scope）管理，
 * dispose() 时按逆序释放，确保干净的生命周期管理。
 */

import {
    getRoleInfoForCommandContext,
    switchRoleForCommandContext,
} from '@/agent/session/session-runtime.js';
import { ChatService } from '@/agent/session/session-service.js';
import { createSubAgentTools } from '@/agent/subagent/subagent-tools.js';
import type { CommandDefinition } from '@/contracts/commands.js';
import { createHelpCommandGroup } from '@/features/commands/help-command-group.js';
import { CommandManager } from '@/features/commands/command-registry.js';
import { createSessionCommandGroup } from '@/features/commands/session-command-group.js';
import { cronTools } from '@/features/cron/cron-tools.js';
import { createPluginCommandGroup } from '@/features/plugins/plugin-command-group.js';
import { PluginManager } from '@/features/plugins/plugin-manager.js';
import { createRoleCommandGroup } from '@/features/roles/role-command-group.js';
import { logger } from '@/platform/observability/logger.js';
import { createRegistrationOwner } from '@/platform/registration/types.js';
import { createMultimodalTools } from '@/platform/tools/multimodal-tools.js';
import { ToolManager } from '@/platform/tools/registry.js';
import type {
    ConfigManagerService,
    RoleManagerService,
    SkillManagerService,
} from '@/contracts/runtime-services.js';

type DisposableRegistrationScope = {
    dispose(): void;
};

type SystemTool = Parameters<ReturnType<ToolManager['createScope']>['register']>[0];

interface SystemRuntimeDependencies {
    toolManager: ToolManager;
    commandManager: CommandManager;
    pluginManager: PluginManager;
    chatService: ChatService;
    configManager: ConfigManagerService;
    roleManager: RoleManagerService;
    skillManager: SkillManagerService;
}

/** 系统级工具与命令注册运行时
 *
 * 将所有内置工具与命令注册到对应的作用域中，
 * 并跟踪这些作用域以便在销毁时统一释放。
 */
export class SystemRuntime {
    private systemRegistrationScopes: DisposableRegistrationScope[] = [];

    constructor(private readonly deps: SystemRuntimeDependencies) {}

    /** 注册所有系统工具与命令 */
    register(): void {
        const multimodalTools = createMultimodalTools(() => this.deps.configManager.config);
        const subAgentTools = createSubAgentTools({
            toolCatalog: this.deps.toolManager,
            hookRuntime: this.deps.pluginManager,
            configSource: {
                getConfig: () => this.deps.configManager.config,
            },
            roleStore: this.deps.roleManager,
            skillStore: this.deps.skillManager,
        });

        this.registerSystemTools('subagent-tools', subAgentTools, 'SubAgent tools registered');
        this.registerSystemTools(
            'multimodal-tools',
            [
                multimodalTools.speechToTextTool,
                multimodalTools.imageUnderstandingTool,
                multimodalTools.sendMsgTool,
            ],
            'Multimodal tools registered',
        );
        this.registerSystemTools('cron-tools', cronTools, 'Cron tools registered');
        this.registerSystemCommands();
    }

    /** 按逆序释放所有系统注册作用域 */
    dispose(): void {
        const scopes = this.systemRegistrationScopes.reverse();
        this.systemRegistrationScopes = [];

        for (const scope of scopes) {
            try {
                scope.dispose();
            } catch (error) {
                logger.error({ error }, 'Failed to dispose system registration scope');
            }
        }
    }

    /** 构建系统命令列表（帮助 → 插件 → 会话 → 角色） */
    private buildSystemCommands(): CommandDefinition[] {
        return [
            ...createHelpCommandGroup(this.deps.commandManager),
            ...createPluginCommandGroup({
                getPluginCommands: () => this.deps.commandManager.getPluginCommands(),
                enablePlugin: (pluginName) => this.deps.pluginManager.enablePlugin(pluginName),
                disablePlugin: (pluginName) => this.deps.pluginManager.disablePlugin(pluginName),
            }),
            ...createSessionCommandGroup(this.deps.chatService),
            ...createRoleCommandGroup({
                getSessionForCommand: (ctx) => ({
                    switchRole: (roleId) =>
                        switchRoleForCommandContext(this.deps.chatService, ctx, roleId),
                    getRoleInfo: () => getRoleInfoForCommandContext(this.deps.chatService, ctx),
                }),
                toolCatalog: this.deps.toolManager,
            }),
        ];
    }

    /** 跟踪注册作用域，以便 dispose 时统一释放 */
    private trackSystemScope<T extends DisposableRegistrationScope>(scope: T): T {
        this.systemRegistrationScopes.push(scope);
        return scope;
    }

    /** 注册系统命令到独立作用域 */
    private registerSystemCommands(): void {
        const systemScope = this.trackSystemScope(
            this.deps.commandManager.createScope(createRegistrationOwner('system', 'bootstrap')),
        );
        const systemCommands = this.buildSystemCommands();
        systemScope.registerMany(systemCommands);
        logger.info({ count: systemCommands.length }, '系统命令已注册');
    }

    /** 注册系统工具到独立作用域 */
    private registerSystemTools(
        ownerId: string,
        tools: Iterable<SystemTool>,
        logMessage: string,
    ): void {
        const scope = this.trackSystemScope(
            this.deps.toolManager.createScope(createRegistrationOwner('system', ownerId)),
        );
        let toolCount = 0;

        for (const tool of tools) {
            scope.register(tool);
            toolCount += 1;
        }

        logger.info({ toolCount }, logMessage);
    }
}
