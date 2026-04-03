import { ZodType } from 'zod';
import { ITool, ToolExecuteContext, ToolExecutionResult, ToolDefinition, ToolParameters } from '../types';

export interface MCPServerInfo {
  name: string;
  connected: boolean;
  lastChecked?: Date;
  error?: string;
  toolCount: number;
}

export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpToolAdapter implements ITool {
  readonly name: string;
  readonly description: string;
  readonly parametersSchema: ZodType;
  readonly serverName: string;
  
  private executeToolFn: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;

  constructor(
    serverName: string,
    toolInfo: MCPToolInfo,
    executeToolFn: (args: Record<string, unknown>) => Promise<ToolExecutionResult>
  ) {
    this.serverName = serverName;
    this.name = `${serverName}_${toolInfo.name}`;
    this.description = toolInfo.description || `Tool from ${serverName}: ${toolInfo.name}`;
    this.parametersSchema = this.parseInputSchema(toolInfo.inputSchema);
    this.executeToolFn = executeToolFn;
  }

  private parseInputSchema(schema: Record<string, unknown>): ZodType {
    const { z } = require('zod');
    
    if (!schema || typeof schema !== 'object') {
      return z.object({});
    }

    const properties = schema.properties as Record<string, unknown> || {};
    const required = (schema.required as string[]) || [];

    const shape: Record<string, ZodType> = {};

    for (const [key, prop] of Object.entries(properties)) {
      shape[key] = this.zodFromJsonSchema(prop as Record<string, unknown>);
    }

    const schemaObj = z.object(shape);
    
    if (required.length === 0) {
      return schemaObj.optional();
    }

    return schemaObj;
  }

  private zodFromJsonSchema(prop: Record<string, unknown>): ZodType {
    const { z } = require('zod');
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
      case 'array':
        const items = prop.items as Record<string, unknown>;
        return z.array(items ? this.zodFromJsonSchema(items) : z.any());
      case 'object':
        const props = prop.properties as Record<string, unknown> || {};
        const shape: Record<string, ZodType> = {};
        for (const [k, v] of Object.entries(props)) {
          shape[k] = this.zodFromJsonSchema(v as Record<string, unknown>);
        }
        return z.object(shape);
      default:
        return z.any();
    }
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {},
      },
    };
  }

  async execute(args: unknown, context: ToolExecuteContext): Promise<ToolExecutionResult> {
    try {
      const result = await this.executeToolFn(args as Record<string, unknown>);
      return result;
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
