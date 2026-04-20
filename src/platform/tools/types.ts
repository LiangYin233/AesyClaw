/** @file 工具系统核心类型定义
 *
 * 定义工具接口、参数 schema、执行上下文与结果等类型，
 * 是工具注册与执行的基础合约。
 */

import { z, ZodType } from 'zod';

/** 工具参数中单个属性的 schema 定义 */
export interface ToolParameterProperty {
    type: string;
    description?: string;
    enum?: string[];
    items?: ToolParameterProperty;
    properties?: Record<string, ToolParameterProperty>;
    required?: string[];
}

/** 工具参数的 JSON Schema 风格定义 */
export interface ToolParameters {
    type: 'object';
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
    additionalProperties?: boolean;
    [key: string]: unknown;
}

/** 工具定义，包含名称、描述与参数 schema，用于 LLM function calling */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: ToolParameters;
}

/** 工具执行结果中的媒体文件描述 */
export interface ToolMediaFile {
    type: string;
    url: string;
    filename?: string;
}

/** 工具通过 ctx.send 回发消息时的载荷格式 */
export interface ToolSendPayload {
    text: string;
    mediaFiles?: ToolMediaFile[];
}

/** 工具执行上下文
 *
 * 携带当前会话与发送者信息，以及权限与回发能力。
 * 工具实现可通过此上下文判断调用者身份及权限范围。
 */
export interface ToolExecuteContext {
    /** 当前会话标识 */
    chatId: string;
    /** 消息发送者标识 */
    senderId: string;
    /** 当前角色标识（用于权限过滤） */
    roleId?: string;
    /** 当前角色允许使用的工具列表 */
    allowedTools?: string[];
    /** 当前角色允许使用的技能列表 */
    allowedSkills?: string[];
    /** 向当前频道回发消息 */
    send?: (_payload: ToolSendPayload) => Promise<void>;
    [key: string]: unknown;
}

/** 工具执行结果 */
export interface ToolExecutionResult {
    /** 是否执行成功 */
    success: boolean;
    /** 执行结果文本内容（成功时为输出，失败时为错误描述） */
    content: string;
    /** 错误信息（仅在 success 为 false 时存在） */
    error?: string;
    /** 额外元数据 */
    metadata?: Record<string, unknown>;
}

/** 工具接口
 *
 * 所有注册到系统中的工具均需实现此接口。
 * 使用 Zod schema 定义参数，运行时自动转换为 JSON Schema 供 LLM 调用。
 */
export interface Tool {
    /** 工具唯一标识名称 */
    readonly name: string;
    /** 工具功能描述，供 LLM 理解何时调用此工具 */
    readonly description: string;
    /** 参数的 Zod schema，用于验证与 JSON Schema 生成 */
    readonly parametersSchema: ZodType;

    /** 返回供 LLM function calling 使用的工具定义 */
    getDefinition(): ToolDefinition;
    /** 执行工具逻辑，返回执行结果 */
    execute(_args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult>;
}

/** 将 Zod schema 转换为工具参数定义格式 */
export function zodToToolParameters(schema: ZodType): ToolParameters {
    return convertJsonSchemaToToolParameters(z.toJSONSchema(schema) as Record<string, unknown>);
}

/** 将 JSON Schema 对象递归转换为 ToolParameters 格式 */
function convertJsonSchemaToToolParameters(jsonSchema: Record<string, unknown>): ToolParameters {
    const properties: Record<string, ToolParameterProperty> = {};
    const required: string[] = [];

    if (jsonSchema.type === 'object' && jsonSchema.properties) {
        const props = jsonSchema.properties as Record<string, unknown>;
        const req = (jsonSchema.required as string[]) || [];

        for (const [key, value] of Object.entries(props)) {
            properties[key] = convertProperty(value as Record<string, unknown>);
            if (req.includes(key)) {
                required.push(key);
            }
        }
    }

    return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
        additionalProperties:
            typeof jsonSchema.additionalProperties === 'boolean'
                ? jsonSchema.additionalProperties
                : true,
    };
}

/** 递归转换单个属性定义 */
function convertProperty(prop: Record<string, unknown>): ToolParameterProperty {
    const result: ToolParameterProperty = {
        type: (prop.type as string) || 'string',
    };

    if (prop.description) {
        result.description = prop.description as string;
    }

    if (prop.enum) {
        result.enum = prop.enum as string[];
    }

    if (prop.type === 'array' && prop.items) {
        result.items = convertProperty(prop.items as Record<string, unknown>);
    }

    if (prop.type === 'object' && prop.properties) {
        const nestedProps: Record<string, ToolParameterProperty> = {};
        const nestedRequired = Array.isArray(prop.required) ? (prop.required as string[]) : [];
        const nestedPropsObj = prop.properties as Record<string, unknown>;
        for (const [key, value] of Object.entries(nestedPropsObj)) {
            nestedProps[key] = convertProperty(value as Record<string, unknown>);
        }
        result.properties = nestedProps;
        result.required = nestedRequired.length > 0 ? nestedRequired : undefined;
    }

    return result;
}
