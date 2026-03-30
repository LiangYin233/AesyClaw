/**
 * 插件钩子执行引擎
 * 
 * 负责执行所有插件的钩子处理器，包括：
 * - 转换钩子（可以修改值或返回 null 中断）
 * - 观察钩子（只读，并行执行）
 */

import type { LLMResponse } from '../../../types.js';
import type { 
  RunningPlugin, 
  ToolCallInfo, 
  AgentContext,
  TransformHandler,
  ObserverHandler 
} from './types.js';
import type { Logger } from '../../../platform/observability/index.js';

/**
 * 执行转换钩子链
 * 
 * 特性：
 * - 串行执行（按插件加载顺序）
 * - 每个处理器可以修改值
 * - 返回 null 表示中断整个链
 * - 单个处理器错误不影响其他处理器
 */
export async function runTransformChain<T>(
  plugins: RunningPlugin[],
  hookName: 'incomingMessage' | 'outgoingMessage' | 'beforeToolCall',
  initialValue: T,
  logger: Logger
): Promise<T | null> {
  let current = initialValue;
  
  // 按 order 排序
  const sortedPlugins = [...plugins].sort((a, b) => a.order - b.order);
  
  for (const plugin of sortedPlugins) {
    const handlers = plugin.hooks[hookName] as unknown as TransformHandler<T>[];
    
    for (const handler of handlers) {
      try {
        const result = await handler(current);
        
        if (result === null) {
          // 中断链
          logger.debug(`钩子中断`, { 
            plugin: plugin.name, 
            hook: hookName 
          });
          return null;
        }
        
        current = result;
      } catch (error) {
        // 记录错误但继续执行
        logger.warn(`钩子执行失败`, { 
          plugin: plugin.name, 
          hook: hookName, 
          error 
        });
      }
    }
  }
  
  return current;
}

/**
 * 执行工具调用后钩子链
 * 
 * 特性：
 * - 串行执行
 * - 可以修改结果字符串
 * - 返回 null 时不回滚，继续使用当前值
 */
export async function runAfterToolChain(
  plugins: RunningPlugin[],
  toolInfo: ToolCallInfo,
  initialResult: string,
  logger: Logger
): Promise<string> {
  let current = initialResult;
  
  const sortedPlugins = [...plugins].sort((a, b) => a.order - b.order);
  
  for (const plugin of sortedPlugins) {
    for (const handler of plugin.hooks.afterToolCall) {
      try {
        const result = await handler(toolInfo, current);
        current = result;
      } catch (error) {
        logger.warn(`工具后钩子执行失败`, { 
          plugin: plugin.name, 
          hook: 'afterToolCall', 
          error 
        });
      }
    }
  }
  
  return current;
}

/**
 * 执行观察钩子（并行）
 * 
 * 特性：
 * - 并行执行所有处理器
 * - 只读，不修改值
 * - 使用 Promise.all 等待所有完成
 * - 单个错误不影响其他处理器
 */
export async function runObservers<T>(
  plugins: RunningPlugin[],
  hookName: keyof Pick<RunningPlugin['hooks'], 'agentStart' | 'error'>,
  payload: T,
  logger: Logger
): Promise<void> {
  const handlers: Array<{ plugin: string; handler: ObserverHandler<T> }> = [];
  
  // 收集所有处理器
  for (const plugin of plugins) {
    const hookHandlers = plugin.hooks[hookName] as ObserverHandler<T>[];
    for (const handler of hookHandlers) {
      handlers.push({ plugin: plugin.name, handler });
    }
  }
  
  // 并行执行
  await Promise.all(
    handlers.map(async ({ plugin, handler }) => {
      try {
        await handler(payload);
      } catch (error) {
        logger.warn(`观察钩子执行失败`, { 
          plugin, 
          hook: hookName, 
          error 
        });
      }
    })
  );
}

/**
 * 执行 Agent 完成观察钩子（特殊版本，因为需要两个参数）
 */
export async function runAgentCompleteObservers(
  plugins: RunningPlugin[],
  context: AgentContext,
  response: LLMResponse,
  logger: Logger
): Promise<void> {
  const handlers: Array<{ plugin: string; handler: (ctx: AgentContext, resp: LLMResponse) => Promise<void> | void }> = [];
  
  for (const plugin of plugins) {
    for (const handler of plugin.hooks.agentComplete) {
      handlers.push({ plugin: plugin.name, handler });
    }
  }
  
  await Promise.all(
    handlers.map(async ({ plugin, handler }) => {
      try {
        await handler(context, response);
      } catch (error) {
        logger.warn(`Agent完成钩子执行失败`, { 
          plugin, 
          hook: 'agentComplete', 
          error 
        });
      }
    })
  );
}

/**
 * 命令匹配结果
 */
interface MatchResult {
  matched: boolean;
  args: string[];
}

/**
 * 匹配命令
 * 
 * 支持四种匹配模式：
 * 1. regex: 正则匹配，返回捕获组
 * 2. exact: 精确匹配，无参数
 * 3. prefix: 前缀匹配，返回剩余部分按空白分割
 * 4. contains: 包含匹配，返回关键字后的部分
 */
export function matchCommand(content: string, pattern: NonNullable<import('./types.js').PluginCommand['pattern']>): MatchResult {
  switch (pattern.matchStyle) {
    case 'regex': {
      const match = content.match(pattern.pattern);
      return match 
        ? { matched: true, args: match.slice(1) } 
        : { matched: false, args: [] };
    }
    
    case 'exact': {
      return content === pattern.text 
        ? { matched: true, args: [] } 
        : { matched: false, args: [] };
    }
    
    case 'prefix': {
      if (!content.startsWith(pattern.prefix)) {
        return { matched: false, args: [] };
      }
      const remaining = content.slice(pattern.prefix.length).trim();
      const args = remaining ? remaining.split(/\s+/).filter(Boolean) : [];
      return { matched: true, args };
    }
    
    case 'contains': {
      if (!content.includes(pattern.keyword)) {
        return { matched: false, args: [] };
      }
      const parts = content.split(pattern.keyword);
      const remaining = parts[1]?.trim() ?? '';
      const args = remaining ? remaining.split(/\s+/).filter(Boolean) : [];
      return { matched: true, args };
    }
    
    default:
      return { matched: false, args: [] };
  }
}
