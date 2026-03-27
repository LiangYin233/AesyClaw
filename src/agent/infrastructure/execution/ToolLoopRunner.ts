import type { LLMMessage, ToolCall } from '../../../types.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import type { ToolRegistry, ToolContext } from '../../../platform/tools/ToolRegistry.js';
import type { PluginManager } from '../../../features/plugins/index.js';
import type { ExecutionResult, ExecutionOptions } from './ExecutionTypes.js';
import { normalizeExecutionError, isRetryableExecutionError } from './errors.js';
import { tokenUsage } from '../../../platform/observability/index.js';
import { ContextBudgetManager } from './ContextBudgetManager.js';

export class ToolLoopRunner {
  private contextBudgetManager = new ContextBudgetManager();

  constructor(
    private provider: LLMProvider,
    private toolRegistry: ToolRegistry,
    private pluginManager?: PluginManager,
    private maxContextTokens?: number
  ) {}

  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  async run(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options: ExecutionOptions & {
      model: string;
    }
  ): Promise<ExecutionResult> {
    const toolsUsed: string[] = [];
    const max = options.maxIterations ?? 40;
    const allowTools = options.allowTools ?? true;
    const source = options.source ?? 'user';
    const initialToolCalls = options.initialToolCalls;
    const executionSignal = options.signal;
    const activeProvider = this.provider;

    let agentMode = !!initialToolCalls;
    let toolCallQueue = [...(initialToolCalls || [])];
    let iteration = 0;
    const checkAbort = () => {
      if (executionSignal?.aborted) {
        const reason = executionSignal.reason;
        if (reason instanceof Error) {
          throw reason;
        }
        throw new Error(typeof reason === 'string' ? reason : 'Execution aborted');
      }
    };

    if (toolCallQueue.length === 0) {
      checkAbort();
      const tools = allowTools ? this.toolRegistry.getDefinitions() : [];
      const requestMessages = this.contextBudgetManager.fit(messages, tools, {
        maxContextTokens: this.maxContextTokens
      });
      const response = await activeProvider.chat(requestMessages, tools, options.model, {
        signal: executionSignal,
      });

      if (response.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
        tokenUsage.record(prompt_tokens, completion_tokens, total_tokens);
      }

      if (response.toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: response.content || '' });
        return {
          content: response.content || '',
          reasoning_content: response.reasoning_content,
          toolsUsed,
          agentMode
        };
      }

      messages.push({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls
      });
      toolCallQueue = response.toolCalls;
      agentMode = true;
    }

    while (toolCallQueue.length > 0 && iteration < max) {
      iteration++;
      checkAbort();
      // 执行当前队列中的所有 toolCalls
      for (const toolCall of toolCallQueue) {
        checkAbort();

        const toolName = toolCall.name;
        if (!toolName) {
          continue;
        }

        toolsUsed.push(toolName);
        let toolArgs = toolCall.arguments || {};
        let result: string;

        try {
          let execToolName = toolName;
          if (execToolName.includes(':')) {
            execToolName = execToolName.replace(':', '_mcp_');
          }

          let execContext: ToolContext = { ...toolContext, source, signal: executionSignal };

          if (this.pluginManager) {
            const nextPayload = await this.pluginManager.runToolBeforeHooks({
              toolName,
              params: toolArgs,
              context: execContext
            });
            toolArgs = nextPayload.params;
            execContext = nextPayload.context ?? execContext;
          }

          result = await this.toolRegistry.execute(execToolName, toolArgs, execContext);

          if (this.pluginManager) {
            const nextPayload = await this.pluginManager.runToolAfterHooks({
              toolName,
              params: toolArgs,
              result,
              context: execContext
            });
            result = nextPayload.result;
          }
        } catch (error: unknown) {
          const message = normalizeExecutionError(error);
          const isRetryable = isRetryableExecutionError(error);
          result = `Error: ${message}${isRetryable ? ' (retryable)' : ''}`;

          if (this.pluginManager) {
            await this.pluginManager.runErrorTaps(error, { type: 'tool', data: { toolName, toolArgs } });
          }
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
      const requestMessages = this.contextBudgetManager.fit(messages, tools, {
        maxContextTokens: this.maxContextTokens
      });
      const response = await activeProvider.chat(requestMessages, tools, options.model, {
        signal: executionSignal
      });

      if (response.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
        tokenUsage.record(prompt_tokens, completion_tokens, total_tokens);
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
    options?: { allowTools?: boolean; reasoning?: boolean; signal?: AbortSignal }
  ): Promise<{ content: string; reasoning_content?: string; usage?: any; toolCalls: ToolCall[] }> {
    const tools = options?.allowTools !== false ? this.toolRegistry.getDefinitions() : [];
    const requestMessages = this.contextBudgetManager.fit(messages, tools, {
      maxContextTokens: this.maxContextTokens
    });
    const response = await this.provider.chat(requestMessages, tools, model, {
      reasoning: options?.reasoning,
      signal: options?.signal
    });
    return {
      content: response.content || '',
      reasoning_content: response.reasoning_content,
      usage: response.usage,
      toolCalls: response.toolCalls
    };
  }
}
