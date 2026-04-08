

import { ZodType } from 'zod';

export interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameterProperty;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export interface ToolExecuteContext {
  chatId: string;
  senderId: string;
  traceId: string;
  [key: string]: unknown;
}

export interface ToolExecutionResult {
  success: boolean;
  content: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ITool {
  readonly name: string;
  readonly description: string;
  readonly parametersSchema: ZodType;

  getDefinition(): ToolDefinition;
  execute(_args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  content: string;
  error?: string;
  executionTime?: number;
}

export function zodToToolParameters(schema: ZodType): ToolParameters {
  const parsed = schema.safeParse({});
  if (!parsed.success) {
    return {
      type: 'object',
      properties: {},
    };
  }
  return convertJsonSchemaToToolParameters(parsed.data as Record<string, unknown>);
}

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
    additionalProperties: true,
  };
}

function convertProperty(prop: Record<string, unknown>): ToolParameterProperty {
  const result: ToolParameterProperty = {
    type: prop.type as string || 'string',
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
    const nestedPropsObj = prop.properties as Record<string, unknown>;
    for (const [key, value] of Object.entries(nestedPropsObj)) {
      nestedProps[key] = convertProperty(value as Record<string, unknown>);
    }
    result.properties = nestedProps;
  }

  return result;
}


