import type { LLMMessage, ToolCall } from '../../../types.js';
import type { LLMProvider } from '../../../providers/base.js';
import type { ToolRegistry, ToolContext } from '../../../tools/ToolRegistry.js';
import type { PluginManager } from '../../../plugins/index.js';
import type { ExecutionResult, ExecutionOptions, VisionSettings } from './types.js';
import { logger, normalizeError, isRetryableError } from '../../../logger/index.js';
import { metrics } from '../../../logger/Metrics.js';
import { tokenStats } from '../../../logger/TokenStats.js';

export class ToolLoopRunner {
  private log = logger.child({ prefix: 'ToolLoopRunner' });

  constructor(
    private provider: LLMProvider,
    private toolRegistry: ToolRegistry,
    private pluginManager?: PluginManager,
    private visionSettings?: VisionSettings
  ) {}

  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  setPluginManager(pluginManager?: PluginManager): void {
    this.pluginManager = pluginManager;
  }

  async run(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options: ExecutionOptions & {
      model: string;
      providerOverride?: LLMProvider;
      reasoningOverride?: boolean;
    }
  ): Promise<ExecutionResult> {
    const toolsUsed: string[] = [];
    const max = options.maxIterations ?? 40;
    const allowTools = options.allowTools ?? true;
    const source = options.source ?? 'user';
    const initialToolCalls = options.initialToolCalls;
    const executionSignal = options.signal;
    const agentLabel = options.agentName || 'main';
    const activeProvider = options.providerOverride ?? this.provider;
    const reasoning = options.reasoningOverride ?? this.visionSettings?.reasoning;

    let agentMode = !!initialToolCalls;
    let toolCallQueue = [...(initialToolCalls || [])];
    let iteration = 0;
    const startedAt = Date.now();

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
      const response = await activeProvider.chat(messages, tools, options.model, {
        signal: executionSignal,
        reasoning
      });

      if (response.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
        metrics.record('llm.tokens.prompt', prompt_tokens, 'count', { source });
        metrics.record('llm.tokens.completion', completion_tokens, 'count', { source });
        metrics.record('llm.tokens.total', total_tokens, 'count', { source });
        tokenStats.record(prompt_tokens, completion_tokens, total_tokens);
      }

      if (response.toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: response.content || '' });
        this.log.info('Execution completed', {
          agent: agentLabel,
          iteration,
          toolCount: toolsUsed.length,
          durationMs: Date.now() - startedAt,
          sessionKey: options.sessionKey,
          finishReason: 'stop'
        });
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
      const currentToolNames = toolCallQueue.map((toolCall) => toolCall.name).filter(Boolean);

      // 执行当前队列中的所有 toolCalls
      for (const toolCall of toolCallQueue) {
        checkAbort();

        const toolName = toolCall.name;
        if (!toolName) {
          this.log.error('Tool call missing name', { iteration, sessionKey: options.sessionKey, toolCallPreview: this.log.preview(JSON.stringify(toolCall)) });
          continue;
        }

        toolsUsed.push(toolName);
        const toolStartedAt = Date.now();
        this.log.info('Tool started', {
          agent: agentLabel,
          toolName,
          iteration,
          sessionKey: options.sessionKey
        });

        let toolArgs = toolCall.arguments || {};
        let result: string;

        try {
          let execToolName = toolName;
          if (execToolName.includes(':')) {
            execToolName = execToolName.replace(':', '_mcp_');
          }

          const execContext = { ...toolContext, source, signal: executionSignal };

          if (this.pluginManager) {
            toolArgs = await this.pluginManager.applyOnBeforeToolCall(toolName, toolArgs, execContext);
          }

          result = await this.toolRegistry.execute(execToolName, toolArgs, execContext);
          this.log.info('Tool completed', {
            agent: agentLabel,
            toolName,
            iteration,
            durationMs: Date.now() - toolStartedAt,
            sessionKey: options.sessionKey
          });

          if (this.pluginManager) {
            result = await this.pluginManager.applyOnToolCall(toolName, toolArgs, result);
          }
        } catch (error: unknown) {
          const message = normalizeError(error);
          const isRetryable = isRetryableError(error);
          result = `Error: ${message}${isRetryable ? ' (retryable)' : ''}`;
          this.log.error('Tool failed', {
            agent: agentLabel,
            toolName,
            iteration,
            durationMs: Date.now() - toolStartedAt,
            retryable: isRetryable,
            sessionKey: options.sessionKey,
            error: message
          });

          if (this.pluginManager) {
            await this.pluginManager.applyOnError(error, { type: 'tool', data: { toolName, toolArgs } });
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
      this.log.debug('LLM loop iteration', {
        agent: agentLabel,
        iteration,
        currentTools: currentToolNames,
        sessionKey: options.sessionKey
      });

      const tools = allowTools ? this.toolRegistry.getDefinitions() : [];
      const response = await activeProvider.chat(messages, tools, options.model, {
        signal: executionSignal,
        reasoning
      });

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
        this.log.info('Execution completed', {
          agent: agentLabel,
          iteration,
          toolCount: toolsUsed.length,
          durationMs: Date.now() - startedAt,
          sessionKey: options.sessionKey,
          finishReason: 'stop'
        });
        return {
          content: response.content || '',
          reasoning_content: response.reasoning_content,
          toolsUsed,
          agentMode
        };
      }
    }

    if (toolCallQueue.length > 0) {
      this.log.warn('Execution reached max iterations', {
        agent: agentLabel,
        maxIterations: max,
        toolCount: toolsUsed.length,
        durationMs: Date.now() - startedAt,
        sessionKey: options.sessionKey
      });
      return { content: '已达到最大迭代次数', reasoning_content: undefined, toolsUsed, agentMode };
    }

    // 正常结束
    const lastMessage = messages[messages.length - 1];
    const lastContent = typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : lastMessage?.content?.find((c: any) => c.type === 'text')?.text || '';
    this.log.info('Execution completed', {
      agent: agentLabel,
      iteration,
      toolCount: toolsUsed.length,
      durationMs: Date.now() - startedAt,
      sessionKey: options.sessionKey,
      finishReason: 'final-message'
    });
    return { content: lastContent, reasoning_content: undefined, toolsUsed, agentMode };
  }

  /**
   * 纯 LLM 调用（无工具）
   */
  async callLLM(
    messages: LLMMessage[],
    model: string,
    options?: { allowTools?: boolean; reasoning?: boolean; signal?: AbortSignal; providerOverride?: LLMProvider }
  ): Promise<{ content: string; reasoning_content?: string; usage?: any; toolCalls: ToolCall[] }> {
    const tools = options?.allowTools !== false ? this.toolRegistry.getDefinitions() : [];
    const response = await (options?.providerOverride ?? this.provider).chat(messages, tools, model, {
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
