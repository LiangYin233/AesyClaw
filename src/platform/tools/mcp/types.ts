import type { Tool as AesyiuTool } from 'aesyiu';
import { ZodType, z } from 'zod';
import { Tool, ToolExecuteContext, ToolExecutionResult, ToolDefinition, type ToolParameters } from '../types.js';
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

export class McpToolAdapter implements Tool {
  readonly name: string;
  readonly description: string;
  readonly parametersSchema: ZodType;
  readonly serverName: string;
  
  private readonly tool: AesyiuTool;
  private readonly toolParameters: ToolParameters;

  constructor(
    serverName: string,
    tool: AesyiuTool,
  ) {
    this.serverName = serverName;
    this.tool = tool;
    this.name = buildMcpToolName(serverName, tool.name);
    this.description = tool.description || `Tool from ${serverName}: ${tool.name}`;
    this.toolParameters = this.normalizeToolParameters(tool.parameters);
    this.parametersSchema = this.parseInputSchema(this.toolParameters);
  }

  private normalizeToolParameters(parameters: unknown): ToolParameters {
    if (!parameters || typeof parameters !== 'object') {
      return {
        type: 'object',
        properties: {},
      };
    }

    const rawParameters = parameters as Record<string, unknown>;
    const properties = rawParameters.properties;
    const required = rawParameters.required;

    return {
      ...rawParameters,
      type: 'object',
      properties:
        properties && typeof properties === 'object' && !Array.isArray(properties)
          ? properties as ToolParameters['properties']
          : {},
      ...(Array.isArray(required)
        ? {
            required: required.filter((item): item is string => typeof item === 'string'),
          }
        : {}),
    } as ToolParameters;
  }

  private parseInputSchema(schema: ToolParameters): ZodType {
    if (!schema || typeof schema !== 'object') {
      return z.object({});
    }

    const properties = schema.properties as Record<string, unknown> || {};
    const required = (schema.required as string[]) || [];

    const shape: Record<string, ZodType> = {};

    for (const [key, prop] of Object.entries(properties)) {
      const propertySchema = this.zodFromJsonSchema(prop as Record<string, unknown>);
      shape[key] = required.includes(key) ? propertySchema : propertySchema.optional();
    }

    return z.object(shape);
  }

  private zodFromJsonSchema(prop: Record<string, unknown>): ZodType {
    if (Array.isArray(prop.enum) && prop.enum.length > 0 && prop.enum.every(value => typeof value === 'string')) {
      const enumValues = prop.enum as [string, ...string[]];
      return z.enum(enumValues);
    }

    const type = prop.type as string;

    switch (type) {
      case 'string':
        return z.string();
      case 'number':
        return z.number();
      case 'integer':
        return z.number().int();
      case 'boolean':
        return z.boolean();
      case 'array': {
        const items = prop.items as Record<string, unknown>;
        return z.array(items ? this.zodFromJsonSchema(items) : z.any());
      }
      case 'object': {
        const props = prop.properties as Record<string, unknown> || {};
        const required = Array.isArray(prop.required)
          ? prop.required.filter((item): item is string => typeof item === 'string')
          : [];
        const shape: Record<string, ZodType> = {};

        for (const [k, v] of Object.entries(props)) {
          const nestedSchema = this.zodFromJsonSchema(v as Record<string, unknown>);
          shape[k] = required.includes(k) ? nestedSchema : nestedSchema.optional();
        }

        return z.object(shape);
      }
      default:
        return z.any();
    }
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: this.toolParameters,
    };
  }

  async execute(args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult> {
    try {
      const result = await this.tool.execute(args as Record<string, unknown>, _context);
      return {
        success: true,
        content: this.normalizeToolContent(result),
      };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: toErrorMessage(error),
      };
    }
  }

  private normalizeToolContent(result: unknown): string {
    if (result === undefined || result === null) {
      return '(no output)';
    }

    if (typeof result === 'string') {
      return result;
    }

    if (typeof result === 'number' || typeof result === 'boolean' || typeof result === 'bigint') {
      return String(result);
    }

    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }
}
