import { ZodError } from 'zod';
import {
  ITool,
  ToolDefinition,
} from './types.js';
import { logger } from '../observability/logger.js';
import { toErrorMessage } from '../utils/errors.js';

export interface ToolValidationError {
  toolName: string;
  error: string;
  issues?: Array<{
    path: string[];
    message: string;
  }>;
}

export class ToolRegistry {
  private tools: Map<string, ITool> = new Map();

  constructor() {
    logger.info('ToolRegistry initialized');
  }

  register(tool: ITool): void {
    if (this.tools.has(tool.name)) {
      logger.warn({ toolName: tool.name }, '工具已存在，将被覆盖');
    }
    this.tools.set(tool.name, tool);
    logger.info(
      { toolName: tool.name, totalTools: this.tools.size },
      '工具已注册'
    );
  }

  unregister(toolName: string): boolean {
    const deleted = this.tools.delete(toolName);
    if (deleted) {
      logger.info(
        { toolName, remainingTools: this.tools.size },
        '工具已注销'
      );
    }
    return deleted;
  }

  getTool(toolName: string): ITool | undefined {
    return this.tools.get(toolName);
  }

  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  getAllToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => tool.getDefinition());
  }

  validateToolArguments(
    toolName: string,
    args: Record<string, unknown>
  ): { valid: boolean; errors?: ToolValidationError; parsedArgs?: Record<string, unknown> } {
    const tool = this.tools.get(toolName);

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
      const parsedArgs = tool.parametersSchema.parse(args);
      return { valid: true, parsedArgs: parsedArgs as Record<string, unknown> };
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map(issue => ({
          path: issue.path.map(String),
          message: issue.message,
        }));
        return {
          valid: false,
          errors: {
            toolName,
            error: `参数验证失败: ${error.message}`,
            issues,
          },
        };
      }
      return {
        valid: false,
        errors: {
          toolName,
          error: toErrorMessage(error),
        },
      };
    }
  }

  getStats(): {
    totalTools: number;
  } {
    return {
      totalTools: this.tools.size,
    };
  }
}

export const toolRegistry = new ToolRegistry();
