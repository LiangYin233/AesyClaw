/** @file MCP 类型与适配器
 *
 * 定义 MCP 服务器信息，以及将 MCP 工具适配为 AesyClaw Tool 的 McpToolAdapter。
 */

import { Type, type TSchema } from '@sinclair/typebox';
import {
    Tool,
    ToolDefinition,
    ToolExecuteContext,
    ToolExecutionResult,
    typeboxToToolParameters,
} from '../types.js';
import { toErrorMessage } from '../../utils/errors.js';

export interface MCPServerInfo {
    name: string;
    connected: boolean;
    lastChecked?: Date;
    error?: string;
    toolCount: number;
}

export function buildMcpToolName(serverName: string, toolName: string): string {
    return `${serverName}.${toolName}`;
}

/** 将 JSON Schema 转换为 Typebox TSchema */
function jsonSchemaToTypebox(schema: unknown): TSchema {
    if (!schema || typeof schema !== 'object') {
        return Type.Object({});
    }

    const s = schema as Record<string, unknown>;
    const type = s.type as string;

    switch (type) {
        case 'string': {
            const enumValues = s.enum;
            if (Array.isArray(enumValues) && enumValues.every((v) => typeof v === 'string')) {
                return Type.Union(enumValues.map((v) => Type.Literal(v)));
            }
            const opts: Record<string, unknown> = {};
            if (s.description) {
                opts.description = s.description;
            }
            if (s.minLength !== undefined) {
                opts.minLength = s.minLength;
            }
            if (s.maxLength !== undefined) {
                opts.maxLength = s.maxLength;
            }
            if (s.pattern) {
                opts.pattern = s.pattern;
            }
            return Type.String(opts);
        }
        case 'number':
        case 'integer': {
            const opts: Record<string, unknown> = {};
            if (s.description) {
                opts.description = s.description;
            }
            if (s.minimum !== undefined) {
                opts.minimum = s.minimum;
            }
            if (s.maximum !== undefined) {
                opts.maximum = s.maximum;
            }
            if (s.exclusiveMinimum !== undefined) {
                opts.exclusiveMinimum = s.exclusiveMinimum;
            }
            if (s.exclusiveMaximum !== undefined) {
                opts.exclusiveMaximum = s.exclusiveMaximum;
            }
            return type === 'integer' ? Type.Integer(opts) : Type.Number(opts);
        }
        case 'boolean': {
            const opts: Record<string, unknown> = {};
            if (s.description) {
                opts.description = s.description;
            }
            return Type.Boolean(opts);
        }
        case 'array': {
            const items = s.items;
            const opts: Record<string, unknown> = {};
            if (s.description) {
                opts.description = s.description;
            }
            return Type.Array(items ? jsonSchemaToTypebox(items) : Type.Any(), opts);
        }
        case 'object': {
            const properties = (s.properties as Record<string, unknown>) || {};
            const required = Array.isArray(s.required) ? (s.required as string[]) : [];
            const props: Record<string, TSchema> = {};

            for (const [key, propSchema] of Object.entries(properties)) {
                const propTypebox = jsonSchemaToTypebox(propSchema);
                props[key] = required.includes(key) ? propTypebox : Type.Optional(propTypebox);
            }

            const opts: Record<string, unknown> = {};
            if (s.description) {
                opts.description = s.description;
            }
            if (s.additionalProperties !== undefined) {
                opts.additionalProperties = s.additionalProperties;
            }
            return Type.Object(props, opts);
        }
        default:
            return Type.Any();
    }
}

/** MCP 工具调用函数类型 */
export type McpToolCallFn = (
    toolName: string,
    args: Record<string, unknown>,
) => Promise<ToolExecutionResult>;

export class McpToolAdapter implements Tool {
    readonly name: string;
    readonly description: string;
    readonly parametersSchema: TSchema;
    readonly serverName: string;
    readonly originalName: string;

    private readonly callTool: McpToolCallFn;

    constructor(
        serverName: string,
        tool: { name: string; description?: string; inputSchema: unknown },
        callTool: McpToolCallFn,
    ) {
        this.serverName = serverName;
        this.originalName = tool.name;
        this.name = buildMcpToolName(serverName, tool.name);
        this.description = tool.description || `Tool from ${serverName}: ${tool.name}`;
        this.parametersSchema = jsonSchemaToTypebox(tool.inputSchema);
        this.callTool = callTool;
    }

    getDefinition(): ToolDefinition {
        return {
            name: this.name,
            description: this.description,
            parameters: typeboxToToolParameters(this.parametersSchema),
        };
    }

    async execute(args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult> {
        try {
            const result = await this.callTool(this.originalName, args as Record<string, unknown>);
            return result;
        } catch (error) {
            return {
                success: false,
                content: '',
                error: toErrorMessage(error),
            };
        }
    }
}
