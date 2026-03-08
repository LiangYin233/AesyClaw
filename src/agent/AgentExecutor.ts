import type { LLMMessage, LLMResponse } from '../types.js';
import type { LLMProvider } from '../providers/base.js';
import type { ToolRegistry, ToolContext } from '../tools/ToolRegistry.js';
import type { PluginManager } from '../plugins/index.js';
import { ContextBuilder } from './ContextBuilder.js';
import { logger, normalizeError, isRetryableError } from '../logger/index.js';
import { metrics } from '../logger/Metrics.js';
import { CONSTANTS } from '../constants/index.js';

export interface ExecuteOptions {
  allowTools?: boolean;
  maxIterations?: number;
  source?: 'user' | 'cron';
}

export interface AgentResult {
  content: string;
  reasoning_content?: string;
  toolsUsed: string[];
  agentMode: boolean;
}

/**
 * Agent 执行器 - 负责 LLM 调用和工具执行循环
 * 独立于消息循环，可被多种消息源复用
 */
export class AgentExecutor {
  private provider: LLMProvider;
  private toolRegistry: ToolRegistry;
  private contextBuilder: ContextBuilder;
  private pluginManager?: PluginManager;
  private model: string;
  private maxIterations: number;
  private log = logger.child({ prefix: 'AgentExecutor' });

  constructor(
    provider: LLMProvider,
    toolRegistry: ToolRegistry,
    workspace: string,
    systemPrompt?: string,
    skillsPrompt?: string,
    model: string = 'gpt-4o',
    maxIterations: number = 40,
    pluginManager?: PluginManager
  ) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.contextBuilder = new ContextBuilder(workspace, systemPrompt, skillsPrompt);
    this.model = model;
    this.maxIterations = maxIterations;
    this.pluginManager = pluginManager;
  }

  /**
   * 执行 Agent 任务（核心 LLM + 工具循环）
   */
  async execute(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options?: ExecuteOptions
  ): Promise<AgentResult> {
    this.log.info(`[LLM_CALL] AgentExecutor.execute() started with ${messages.length} messages, source=${options?.source || 'user'}`);
    const toolsUsed: string[] = [];
    const max = options?.maxIterations ?? this.maxIterations;
    const allowTools = options?.allowTools ?? true;
    const source = options?.source ?? 'user';
    let agentMode = false;

    for (let i = 0; i < max; i++) {
      const tools = allowTools ? this.toolRegistry.getDefinitions(agentMode) : [];

      if (i === 0 && tools.length > 0) {
        this.log.debug(`First round: ${tools.length} tools available (excluding agent-only)`);
      }

      this.log.info(`[LLM_CALL] AgentExecutor.execute() iteration ${i + 1}/${max}, calling provider.chat()`);
      const response = await this.provider.chat(messages, tools, this.model);
      this.log.info(`[LLM_CALL] AgentExecutor.execute() iteration ${i + 1}/${max}, provider.chat() returned, toolCalls=${response.toolCalls.length}`);

      if (response.toolCalls.length > 0) {
        if (!agentMode) {
          agentMode = true;
          this.log.info(`LLM requested tool(s), entering agent mode`);
        }

        messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls
        });

        for (const toolCall of response.toolCalls) {
          const toolName = toolCall.name;

          if (!toolName) {
            this.log.error(`Tool name is undefined, toolCall: ${JSON.stringify(toolCall).substring(0, 200)}`);
            continue;
          }

          toolsUsed.push(toolName);
          this.log.info(`Executing tool: ${toolName}`);

          let toolArgs = toolCall.arguments || {};
          this.log.info(`Tool ${toolName} arguments: ${JSON.stringify(toolArgs)}`);
          this.log.debug(`Tool call ID: ${toolCall.id}, raw arguments type: ${typeof toolCall.arguments}`);

          const toolEndTimer = metrics.timer('agent.tool_execution', { tool: toolName });
          let result: string;

          try {
            let execToolName = toolName;
            if (execToolName.includes(':')) {
              execToolName = execToolName.replace(':', '_mcp_');
            }

            const execContext = { ...toolContext, source };

            this.log.info(`[AgentExecutor] execContext for ${toolName}: channel=${execContext.channel}, chatId=${execContext.chatId}, messageType=${execContext.messageType}`);

            if (this.pluginManager) {
              toolArgs = await this.pluginManager.applyOnBeforeToolCall(toolName, toolArgs, execContext);
              this.log.debug(`After plugin hooks, tool args: ${JSON.stringify(toolArgs).substring(0, 200)}`);
            }

            result = await this.toolRegistry.execute(execToolName, toolArgs, execContext);
            this.log.info(`Tool ${toolName} executed successfully, result length: ${result.length}`);
            this.log.debug(`Tool ${toolName} result preview: ${result.substring(0, CONSTANTS.MESSAGE_TRUNCATE_LENGTH)}`);

            if (this.pluginManager) {
              result = await this.pluginManager.applyOnToolCall(toolName, toolArgs, result);
            }

            metrics.record('agent.tool_call_count', 1, 'count', { tool: toolName, status: 'success' });
          } catch (error: unknown) {
            const message = normalizeError(error);
            const isRetryable = isRetryableError(error);
            result = `Error: ${message}${isRetryable ? ' (retryable)' : ''}`;
            this.log.error(`Tool ${toolName} execution failed (retryable: ${isRetryable}):`, message);

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
      } else {
        this.log.info(`LLM response complete, no tool calls, content length: ${response.content?.length || 0}`);
        messages.push({ role: 'assistant', content: response.content || '' });
        this.log.info(`[LLM_CALL] AgentExecutor.execute() completed successfully, returning result`);
        return { content: response.content || '', reasoning_content: response.reasoning_content, toolsUsed, agentMode };
      }
    }

    this.log.info(`[LLM_CALL] AgentExecutor.execute() reached max iterations, returning`);
    return { content: '已达到最大迭代次数', reasoning_content: undefined, toolsUsed, agentMode };
  }

  /**
   * 直接调用 LLM（供插件使用）
   */
  async callLLM(
    messages: LLMMessage[],
    options?: { allowTools?: boolean; maxIterations?: number }
  ): Promise<{ content: string; reasoning_content?: string }> {
    this.log.info(`[LLM_CALL] AgentExecutor.callLLM() called with ${messages.length} messages, allowTools=${options?.allowTools ?? true}`);
    const tools = options?.allowTools !== false ? this.toolRegistry.getDefinitions() : [];
    const response = await this.provider.chat(messages, tools, this.model);
    this.log.info(`[LLM_CALL] AgentExecutor.callLLM() returned, content length=${response.content?.length || 0}`);
    return { content: response.content || '', reasoning_content: response.reasoning_content };
  }

  buildContext(history: any[], currentMessage: string, media?: string[]): LLMMessage[] {
    return this.contextBuilder.build(history, currentMessage, media);
  }

  setPluginManager(pm: PluginManager): void {
    this.pluginManager = pm;
  }

  setSkillsPrompt(prompt: string): void {
    this.contextBuilder.setSkillsPrompt(prompt);
  }

  updateProvider(provider: LLMProvider, model?: string): void {
    this.provider = provider;
    if (model) this.model = model;
  }

  getContextBuilder(): ContextBuilder {
    return this.contextBuilder;
  }
}
