import type { ToolDefinition } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';
import { CONSTANTS } from '../constants/index.js';

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (params: Record<string, any>, context?: ToolContext) => Promise<string>;
  validate?: (params: Record<string, any>) => string[];
  timeout?: number;
  agentOnly?: boolean;
}

export interface ToolContext {
  workspace: string;
  eventBus?: EventBus;
  source?: 'user' | 'cron';
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT = CONSTANTS.TOOL_TIMEOUT;

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private log = logger.child({ prefix: 'ToolRegistry' });

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    this.log.debug(`Registered tool: ${tool.name}`);
  }

  unregister(name: string): void {
    this.tools.delete(name);
    this.log.debug(`Unregistered tool: ${name}`);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getDefinitions(agentMode: boolean = false): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter(tool => !tool.agentOnly || agentMode)
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }));
  }

  async execute(name: string, params: Record<string, any>, context?: ToolContext): Promise<string> {
    const tool = this.tools.get(name);  // 根据名称获取工具
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    if (tool.validate) {
      const errors = tool.validate(params);  // 验证参数
      if (errors.length > 0) {
        throw new Error(`Validation errors: ${errors.join(', ')}`);
      }
    }

    const timeout = tool.timeout || DEFAULT_TIMEOUT;  // 获取超时时间
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();  // 超时后中止执行
      this.log.warn(`Tool ${name} execution timed out after ${timeout}ms`);
    }, timeout);

    const execContext: ToolContext = {
      workspace: context?.workspace || '',
      eventBus: context?.eventBus,
      source: context?.source,
      signal: controller.signal
    };

    try {
      const result = await Promise.race([
        tool.execute(params, execContext),  // 执行工具
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error('Tool execution aborted'));
          });
        })
      ]);
      clearTimeout(timeoutId);  // 清除超时计时器
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Tool execution timeout: ${tool.name} (${timeout}ms)`);
      }
      throw error;
    }
  }
}
