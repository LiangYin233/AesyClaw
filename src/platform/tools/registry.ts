import { ZodError, ZodType } from 'zod';
import {
  ITool,
  ToolDefinition,
  ToolExecuteContext,
  ToolExecutionResult,
  ToolCallResult,
  ToolCallRequest,
  zodToToolParameters,
} from './types';
import { logger } from '../observability/logger';

export interface ToolValidationError {
  toolName: string;
  error: string;
  issues?: Array<{
    path: string[];
    message: string;
  }>;
}

export interface ToolExecutionReport {
  success: boolean;
  toolName: string;
  executionTime: number;
  result: ToolExecutionResult;
}

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, ITool> = new Map();
  private toolCallHistory: ToolCallResult[] = [];

  private constructor() {
    logger.info('🔧 ToolRegistry 单例已初始化');
  }

  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  register(tool: ITool): void {
    if (this.tools.has(tool.name)) {
      logger.warn({ toolName: tool.name }, '⚠️ 工具已存在，将被覆盖');
    }
    this.tools.set(tool.name, tool);
    logger.info(
      { toolName: tool.name, totalTools: this.tools.size },
      '✅ 工具已注册'
    );
  }

  unregister(toolName: string): boolean {
    const deleted = this.tools.delete(toolName);
    if (deleted) {
      logger.info(
        { toolName, remainingTools: this.tools.size },
        '🗑️ 工具已注销'
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

  getToolDefinitionsByNames(names: string[]): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool) {
        definitions.push(tool.getDefinition());
      } else {
        logger.warn({ toolName: name }, '⚠️ 请求了未注册的工具定义');
      }
    }
    return definitions;
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
          error: error instanceof Error ? error.message : '未知验证错误',
        },
      };
    }
  }

  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecuteContext
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    logger.info(
      { toolName, args, chatId: context.chatId, traceId: context.traceId },
      '🔧 开始执行工具'
    );

    const tool = this.tools.get(toolName);
    if (!tool) {
      const errorResult: ToolExecutionResult = {
        success: false,
        content: '',
        error: `工具 "${toolName}" 未注册`,
      };
      logger.error({ toolName }, '❌ 工具不存在');
      return errorResult;
    }

    const validation = this.validateToolArguments(toolName, args);
    if (!validation.valid) {
      const errorResult: ToolExecutionResult = {
        success: false,
        content: '',
        error: validation.errors!.error,
        metadata: { validationIssues: validation.errors!.issues },
      };
      logger.warn(
        { toolName, errors: validation.errors },
        '⚠️ 工具参数验证失败'
      );
      return errorResult;
    }

    try {
      const result = await tool.execute(validation.parsedArgs, context);
      const executionTime = Date.now() - startTime;

      logger.info(
        { toolName, executionTime, success: result.success },
        '✅ 工具执行完成'
      );

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorResult: ToolExecutionResult = {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : String(error),
        metadata: { executionTime },
      };

      logger.error(
        { toolName, executionTime, error },
        '❌ 工具执行出错'
      );

      return errorResult;
    }
  }

  async executeTools(
    requests: ToolCallRequest[],
    context: ToolExecuteContext
  ): Promise<ToolCallResult[]> {
    const results: ToolCallResult[] = [];

    logger.info(
      { toolCount: requests.length, chatId: context.chatId },
      '🚀 开始批量执行工具'
    );

    for (const request of requests) {
      const result = await this.executeTool(request.name, request.arguments, context);

      const toolCallResult: ToolCallResult = {
        toolCallId: request.id,
        toolName: request.name,
        success: result.success,
        content: result.content,
        error: result.error,
        executionTime: result.metadata?.executionTime as number,
      };

      results.push(toolCallResult);
      this.toolCallHistory.push(toolCallResult);
    }

    logger.info(
      { totalTools: requests.length, successCount: results.filter(r => r.success).length },
      '📊 批量工具执行完成'
    );

    return results;
  }

  generateHallucinationFeedback(
    toolName: string,
    validationErrors: ToolValidationError
  ): string {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return `工具 "${toolName}" 不存在或未注册。`;
    }

    let feedback = `工具 "${toolName}" 调用失败。`;

    if (validationErrors.issues && validationErrors.issues.length > 0) {
      feedback += '\n\n参数错误详情：';
      for (const issue of validationErrors.issues) {
        const pathStr = issue.path.join('.') || 'root';
        feedback += `\n- ${pathStr}: ${issue.message}`;
      }
    }

    feedback += '\n\n请重新调用该工具，提供正确的参数。';

    logger.debug(
      { toolName, feedback },
      '💬 生成反幻觉反馈消息'
    );

    return feedback;
  }

  getToolCallHistory(): ToolCallResult[] {
    return [...this.toolCallHistory];
  }

  getToolCallHistoryByChatId(_chatId: string): ToolCallResult[] {
    return this.toolCallHistory.filter(
      result => result.toolCallId.includes(_chatId)
    );
  }

  clearHistory(): void {
    this.toolCallHistory = [];
    logger.debug('🗑️ 工具调用历史已清空');
  }

  getStats(): {
    totalTools: number;
    totalCalls: number;
    successRate: number;
  } {
    const totalCalls = this.toolCallHistory.length;
    const successCalls = this.toolCallHistory.filter(r => r.success).length;

    return {
      totalTools: this.tools.size,
      totalCalls,
      successRate: totalCalls > 0 ? successCalls / totalCalls : 0,
    };
  }
}
