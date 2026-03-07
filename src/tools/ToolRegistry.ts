import type { ToolDefinition } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';
import { CONSTANTS } from '../constants/index.js';

export type ToolSource = 'built-in' | 'plugin' | 'mcp';

export interface ToolSourceInfo {
  name: string;
  source: ToolSource;
  registeredAt: number;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (params: Record<string, any>, context?: ToolContext) => Promise<string>;
  validate?: (params: Record<string, any>) => string[];
  timeout?: number;
  agentOnly?: boolean;
  source?: ToolSource;
}

export interface ToolContext {
  workspace: string;
  eventBus?: EventBus;
  source?: 'user' | 'cron';
  signal?: AbortSignal;
  chatId?: string;
  messageType?: 'private' | 'group';
  channel?: string;
}

const DEFAULT_TIMEOUT = CONSTANTS.TOOL_TIMEOUT;

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private toolSources: Map<string, ToolSourceInfo> = new Map();
  private log = logger.child({ prefix: 'ToolRegistry' });

  register(tool: Tool, source: ToolSource = 'built-in'): void {
    const toolWithSource = { ...tool, source };
    this.tools.set(tool.name, toolWithSource);
    this.toolSources.set(tool.name, {
      name: tool.name,
      source,
      registeredAt: Date.now()
    });
    this.log.debug(`Registered tool: ${tool.name} (source: ${source})`);
  }

  unregister(name: string): void {
    this.tools.delete(name);
    this.toolSources.delete(name);
    this.log.debug(`Unregistered tool: ${name}`);
  }

  /**
   * 批量注销工具
   */
  unregisterMany(names: string[]): number {
    let count = 0;
    for (const name of names) {
      if (this.tools.has(name)) {
        this.unregister(name);
        count++;
      }
    }
    return count;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getSource(name: string): ToolSourceInfo | undefined {
    return this.toolSources.get(name);
  }

  getBySource(source: ToolSource): Tool[] {
    return Array.from(this.tools.values()).filter(t => t.source === source);
  }

  getAllSources(): ToolSourceInfo[] {
    return Array.from(this.toolSources.values());
  }

  unregisterBySource(source: ToolSource): number {
    let count = 0;
    for (const [name, info] of this.toolSources.entries()) {
      if (info.source === source) {
        this.tools.delete(name);
        this.toolSources.delete(name);
        count++;
      }
    }
    if (count > 0) {
      this.log.debug(`Unregistered ${count} tools from source: ${source}`);
    }
    return count;
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

  /**
   * 获取所有工具列表
   */
  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, params: Record<string, any>, context?: ToolContext): Promise<string> {
    const tool = this.tools.get(name);  // 根据名称获取工具
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    this.log.debug(`Executing tool: ${name}, source: ${tool.source}, params keys: ${Object.keys(params).join(', ')}`);

    if (tool.validate) {
      const errors = tool.validate(params);  // 验证参数
      if (errors.length > 0) {
        this.log.debug(`Tool ${name} validation failed: ${errors.join(', ')}`);
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
      workspace: '',
      ...context,
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
      this.log.debug(`Tool ${name} completed successfully, result length: ${result.length}`);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      this.log.debug(`Tool ${name} execution error: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Tool execution timeout: ${tool.name} (${timeout}ms)`);
      }
      throw error;
    }
  }
}
