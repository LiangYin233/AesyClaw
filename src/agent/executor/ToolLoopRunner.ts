import type { LLMMessage, ToolCall } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';
import type { ToolRegistry, ToolContext } from '../../tools/ToolRegistry.js';
import type { PluginManager } from '../../plugins/index.js';
import type { ExecutionResult, ExecutionOptions, VisionSettings } from './types.js';
import { logger, normalizeError, isRetryableError } from '../../logger/index.js';
import { metrics } from '../../logger/Metrics.js';
import { tokenStats } from '../../logger/TokenStats.js';

export class ToolLoopRunner {
  private log = logger.child({ prefix: 'ToolLoopRunner' });

  constructor(
    private provider: LLMProvider,
    private toolRegistry: ToolRegistry,
    private pluginManager?: PluginManager,
    private visionSettings?: VisionSettings
  ) {}

  async run(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options: ExecutionOptions & { model: string }
  ): Promise<ExecutionResult> {
    const toolsUsed: string[] = [];
    const max = options.maxIterations ?? 40;
    const allowTools = options.allowTools ?? true;
    const source = options.source ?? 'user';
    const sessionKey = options.sessionKey;
    const initialToolCalls = options.initialToolCalls;

    let agentMode = !!initialToolCalls;
    let toolCallQueue = [...(initialToolCalls || [])];
    let iteration = 0;

    // 创建中止控制器
    let abortController: AbortController | undefined;
    if (sessionKey) {
      abortController = new AbortController();
    }

    const checkAbort = () => {
      if (abortController?.signal.aborted) {
        throw new Error('Execution aborted');
      }
    };

    while (toolCallQueue.length > 0 && iteration < max) {
      iteration++;
      checkAbort();

      // 执行当前队列中的所有 toolCalls
      for (const toolCall of toolCallQueue) {
        checkAbort();

        const toolName = toolCall.name;
        if (!toolName) {
          this.log.error(`Tool name is undefined: ${JSON.stringify(toolCall).substring(0, 200)}`);
          continue;
        }

        toolsUsed.push(toolName);
        this.log.info(`Executing tool: ${toolName}`);

        let toolArgs = toolCall.arguments || {};
        const toolEndTimer = metrics.timer('agent.tool_execution', { tool: toolName });
        let result: string;

        try {
          let execToolName = toolName;
          if (execToolName.includes(':')) {
            execToolName = execToolName.replace(':', '_mcp_');
          }

          const execContext = { ...toolContext, source, signal: abortController?.signal };

          if (this.pluginManager) {
            toolArgs = await this.pluginManager.applyOnBeforeToolCall(toolName, toolArgs, execContext);
          }

          result = await this.toolRegistry.execute(execToolName, toolArgs, execContext);
          this.log.info(`Tool ${toolName} executed, result length: ${result.length}`);

          if (this.pluginManager) {
            result = await this.pluginManager.applyOnToolCall(toolName, toolArgs, result);
          }

          metrics.record('agent.tool_call_count', 1, 'count', { tool: toolName, status: 'success' });
        } catch (error: unknown) {
          const message = normalizeError(error);
          const isRetryable = isRetryableError(error);
          result = `Error: ${message}${isRetryable ? ' (retryable)' : ''}`;
          this.log.error(`Tool ${toolName} failed:`, message);

          metrics.record('agent.tool_call_count', 1, 'count', { tool: toolName, status: 'error' });

          if (this.pluginManager) {
            await this.pluginManager.applyOnError(error, { type: 'tool', data: { toolName, toolArgs } });
          }
        } finally {
          toolEndTimer();
        }

        messages.push({
          role: 'tool',
          content: result,
          toolCallId: toolCall.id || '',
          name: toolName
        });
      }

      // 执行完所有 toolCalls 后，继续调用 LLM
      checkAbort();

      const tools = allowTools ? this.toolRegistry.getDefinitions() : [];
      const response = await this.provider.chat(messages, tools, options.model);

      if (response.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
        metrics.record('llm.tokens.prompt', prompt_tokens, 'count', { source });
        metrics.record('llm.tokens.completion', completion_tokens, 'count', { source });
        metrics.record('llm.tokens.total', total_tokens, 'count', { source });
        tokenStats.record(prompt_tokens, completion_tokens, total_tokens);
      }

      if (response.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls
        });
        toolCallQueue = response.toolCalls;
      } else {
        messages.push({ role: 'assistant', content: response.content || '' });
        return {
          content: response.content || '',
          reasoning_content: response.reasoning_content,
          toolsUsed,
          agentMode
        };
      }
    }

    if (toolCallQueue.length > 0) {
      this.log.warn(`Reached max iterations (${max})`);
      return { content: '已达到最大迭代次数', reasoning_content: undefined, toolsUsed, agentMode };
    }

    // 正常结束
    const lastMessage = messages[messages.length - 1];
    const lastContent = typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : lastMessage?.content?.find((c: any) => c.type === 'text')?.text || '';
    return { content: lastContent, reasoning_content: undefined, toolsUsed, agentMode };
  }

  /**
   * 纯 LLM 调用（无工具）
   */
  async callLLM(
    messages: LLMMessage[],
    model: string,
    options?: { allowTools?: boolean }
  ): Promise<{ content: string; reasoning_content?: string; usage?: any; toolCalls: ToolCall[] }> {
    const tools = options?.allowTools !== false ? this.toolRegistry.getDefinitions() : [];
    const response = await this.provider.chat(messages, tools, model);
    return {
      content: response.content || '',
      reasoning_content: response.reasoning_content,
      usage: response.usage,
      toolCalls: response.toolCalls
    };
  }
}
