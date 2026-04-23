/** @file 工具管理器
 *
 * ToolManager 管理工具的注册、查询与反注册，支持：
 * - 按所有者（system/plugin/mcp）隔离的工具注册作用域
 * - 工具参数验证（使用 Typebox schema）
 * - 工具目录查询（供 AgentEngine 获取可用工具列表）
 *
 * 注册流程：
 * 1. createScope() 创建注册作用域
 * 2. scope.register() 注册工具
 * 3. scope.dispose() 或 unregister() 反注册
 */

import { type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { logger } from '@/platform/observability/logger.js';
import { OwnedNameRegistry } from '@/platform/registration/owned-name-registry.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import {
    type RegistrationHandle,
    type RegistrationOwner,
    getRegistrationOwnerKey,
} from '@/platform/registration/types.js';
import type { Tool, ToolDefinition } from './types.js';

/** 工具验证错误信息 */
export interface ToolValidationError {
    toolName: string;
    error: string;
    issues?: Array<{
        path: string[];
        message: string;
    }>;
}

/** 工具目录，提供工具查询接口 */
export interface ToolCatalog {
    getTool(toolName: string): Tool | undefined;
    hasTool(toolName: string): boolean;
    getAllToolDefinitions(): ToolDefinition[];
    getAllToolNames(): string[];
    getStats(): {
        totalTools: number;
    };
}

/** 工具注册端口
 *
 * 每个所有者通过此接口注册和管理自己的工具。
 * dispose() 时自动反注册该所有者下的所有工具。
 */
export interface ToolRegistrationPort {
    readonly owner: RegistrationOwner;
    register(tool: Tool): RegistrationHandle;
    unregister(toolName: string): boolean;
    listOwnedNames(): string[];
    dispose(): void;
}

interface RegisteredToolRecord {
    tool: Tool;
    owner: RegistrationOwner;
}

/** 工具管理器
 *
 * 实现 ToolCatalog 接口，管理所有已注册工具。
 */
export class ToolManager implements ToolCatalog {
    private tools: Map<string, RegisteredToolRecord> = new Map();
    private ownerToolNames = new OwnedNameRegistry();

    constructor() {
        logger.info({}, 'ToolManager initialized');
    }

    /** 为指定所有者创建工具注册作用域 */
    createScope(owner: RegistrationOwner): ToolRegistrationPort {
        return {
            owner,
            register: (tool) => this.register(owner, tool),
            unregister: (toolName) => this.unregister(toolName, owner),
            listOwnedNames: () => this.listOwnedNames(owner),
            dispose: () => {
                this.unregisterAll(owner);
            },
        };
    }

    getTool(toolName: string): Tool | undefined {
        return this.tools.get(toolName)?.tool;
    }

    hasTool(toolName: string): boolean {
        return this.tools.has(toolName);
    }

    getAllToolDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values(), ({ tool }) => tool.getDefinition());
    }

    getAllToolNames(): string[] {
        return Array.from(this.tools.keys());
    }

    /** 验证工具参数是否符合 Typebox schema */
    validateToolArguments(
        toolName: string,
        args: Record<string, unknown>,
    ): {
        valid: boolean;
        errors?: ToolValidationError;
        parsedArgs?: Record<string, unknown>;
    } {
        const tool = this.getTool(toolName);

        if (!tool) {
            return {
                valid: false,
                errors: {
                    toolName,
                    error: `工具 "${toolName}" 未注册`,
                },
            };
        }

        try {
            const schema = tool.parametersSchema as TSchema;
            if (!Value.Check(schema, args)) {
                const errors = [...Value.Errors(schema, args)];
                return {
                    valid: false,
                    errors: {
                        toolName,
                        error: `参数验证失败: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
                        issues: errors.map((e) => ({
                            path: e.path.split('/').filter(Boolean),
                            message: e.message,
                        })),
                    },
                };
            }

            return { valid: true, parsedArgs: args };
        } catch (error) {
            return {
                valid: false,
                errors: {
                    toolName,
                    error: toErrorMessage(error),
                },
            };
        }
    }

    getStats(): { totalTools: number } {
        return {
            totalTools: this.tools.size,
        };
    }

    private register(owner: RegistrationOwner, tool: Tool): RegistrationHandle {
        const existing = this.tools.get(tool.name);
        if (existing) {
            throw new Error(
                `Tool "${tool.name}" is already registered by ${existing.owner.kind}:${existing.owner.id}`,
            );
        }

        this.tools.set(tool.name, { tool, owner });
        this.trackOwnerName(owner, tool.name);

        logger.info(
            {
                toolName: tool.name,
                ownerKind: owner.kind,
                ownerId: owner.id,
                totalTools: this.tools.size,
            },
            'Tool registered',
        );

        return {
            name: tool.name,
            owner,
            dispose: () => this.unregister(tool.name, owner),
        };
    }

    private unregister(toolName: string, owner?: RegistrationOwner): boolean {
        const record = this.tools.get(toolName);
        if (!record) {
            return false;
        }

        if (owner && getRegistrationOwnerKey(record.owner) !== getRegistrationOwnerKey(owner)) {
            return false;
        }

        const deleted = this.tools.delete(toolName);
        if (!deleted) {
            return false;
        }

        this.untrackOwnerName(record.owner, toolName);

        logger.info(
            {
                toolName,
                ownerKind: record.owner.kind,
                ownerId: record.owner.id,
                remainingTools: this.tools.size,
            },
            'Tool unregistered',
        );

        return true;
    }

    private unregisterAll(owner: RegistrationOwner): void {
        for (const toolName of this.listOwnedNames(owner)) {
            this.unregister(toolName, owner);
        }
    }

    private listOwnedNames(owner: RegistrationOwner): string[] {
        return this.ownerToolNames.list(owner);
    }

    private trackOwnerName(owner: RegistrationOwner, toolName: string): void {
        this.ownerToolNames.add(owner, toolName);
    }

    private untrackOwnerName(owner: RegistrationOwner, toolName: string): void {
        this.ownerToolNames.remove(owner, toolName);
    }
}
