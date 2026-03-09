import type { LLMMessage, LLMResponse, InboundFile, VisionSettings, ToolCall } from '../types.js';
import type { LLMProvider } from '../providers/base.js';
import type { ToolRegistry, ToolContext } from '../tools/ToolRegistry.js';
import type { PluginManager } from '../plugins/index.js';
import { ContextBuilder } from './ContextBuilder.js';
import { logger, normalizeError, isRetryableError } from '../logger/index.js';
import { metrics } from '../logger/Metrics.js';
import { tokenStats } from '../logger/TokenStats.js';
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
  private visionSettings?: VisionSettings;
  private visionProvider?: LLMProvider;
  private log = logger.child({ prefix: 'AgentExecutor' });

  constructor(
    provider: LLMProvider,
    toolRegistry: ToolRegistry,
    workspace: string,
    systemPrompt?: string,
    skillsPrompt?: string,
    model: string = 'gpt-4o',
    maxIterations: number = 40,
    pluginManager?: PluginManager,
    visionSettings?: VisionSettings,
    visionProvider?: LLMProvider
  ) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.contextBuilder = new ContextBuilder(workspace, systemPrompt, skillsPrompt);
    this.model = model;
    this.maxIterations = maxIterations;
    this.pluginManager = pluginManager;
    this.visionSettings = visionSettings;
    this.visionProvider = visionProvider;
  }

  /**
   * 判断是否需要使用视觉模型
   * 当 vision: false 但配置了 visionProvider 时，说明当前模型无视觉能力，需要转发给视觉模型
   */
  needsVisionProvider(media?: string[], files?: InboundFile[]): boolean {
    // 如果没有配置视觉模型提供商，不使用
    if (!this.visionSettings?.visionProviderName) return false;

    // 检查是否有媒体内容需要视觉处理
    const hasMedia = media && media.length > 0;
    const hasVisionableFiles = files?.some(f =>
      f.type === 'image' || this.isVisionableFile(f)
    ) ?? false;

    return hasMedia || hasVisionableFiles;
  }

  /**
   * 判断文件是否为图片类型
   */
  private isVisionableFile(file: InboundFile): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    return imageExtensions.some(ext => file.name?.toLowerCase().endsWith(ext));
  }

  /**
   * 使用视觉模型执行
   */
  async executeWithVision(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options?: ExecuteOptions,
    media?: string[],
    files?: InboundFile[]
  ): Promise<AgentResult> {
    if (!this.visionProvider) {
      throw new Error('Vision provider not configured but vision is enabled');
    }

    const visionModel = this.visionSettings?.visionModelName || this.visionProvider.getDefaultModel();
    this.log.info(`Using vision model: ${visionModel}`);

    // 构建包含媒体内容的消息
    const visionMessages = this.buildVisionMessages(messages, media, files);

    // 使用视觉模型执行
    return this.executeWithProvider(this.visionProvider, visionModel, visionMessages, toolContext, options);
  }

  /**
   * 使用指定的提供商执行
   */
  private async executeWithProvider(
    provider: LLMProvider,
    model: string,
    messages: LLMMessage[],
    toolContext: ToolContext,
    options?: ExecuteOptions
  ): Promise<AgentResult> {
    const toolsUsed: string[] = [];
    const max = options?.maxIterations ?? this.maxIterations;
    const allowTools = options?.allowTools ?? true;
    const source = options?.source ?? 'user';
    let agentMode = false;

    for (let i = 0; i < max; i++) {
      const tools = allowTools ? this.toolRegistry.getDefinitions() : [];

      const response = await provider.chat(messages, tools, model);

      if (response.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
        metrics.record('llm.tokens.prompt', prompt_tokens, 'count', { source });
        metrics.record('llm.tokens.completion', completion_tokens, 'count', { source });
        metrics.record('llm.tokens.total', total_tokens, 'count', { source });
        tokenStats.record(prompt_tokens, completion_tokens, total_tokens);
      }

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
          const toolEndTimer = metrics.timer('agent.tool_execution', { tool: toolName });
          let result: string;

          try {
            let execToolName = toolName;
            if (execToolName.includes(':')) {
              execToolName = execToolName.replace(':', '_mcp_');
            }

            const execContext = { ...toolContext, source };

            if (this.pluginManager) {
              toolArgs = await this.pluginManager.applyOnBeforeToolCall(toolName, toolArgs, execContext);
            }

            result = await this.toolRegistry.execute(execToolName, toolArgs, execContext);
            this.log.info(`Tool ${toolName} executed successfully, result length: ${result.length}`);

            if (this.pluginManager) {
              result = await this.pluginManager.applyOnToolCall(toolName, toolArgs, result);
            }

            metrics.record('agent.tool_call_count', 1, 'count', { tool: toolName, status: 'success' });
          } catch (error: unknown) {
            const message = normalizeError(error);
            const isRetryable = isRetryableError(error);
            result = `Error: ${message}${isRetryable ? ' (retryable)' : ''}`;
            this.log.error(`Tool ${toolName} execution failed:`, message);

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
        this.log.info(`LLM response complete, no tool calls`);
        messages.push({ role: 'assistant', content: response.content || '' });
        return { content: response.content || '', reasoning_content: response.reasoning_content, toolsUsed, agentMode };
      }
    }

    this.log.warn(`Reached max iterations (${max})`);
    return { content: '已达到最大迭代次数', reasoning_content: undefined, toolsUsed, agentMode };
  }

  /**
   * 构建包含视觉内容的消息
   */
  private buildVisionMessages(
    baseMessages: LLMMessage[],
    media?: string[],
    files?: InboundFile[]
  ): LLMMessage[] {
    const messages = [...baseMessages];
    const lastMsgIndex = messages.length - 1;

    if (lastMsgIndex < 0) return messages;

    const lastMsg = messages[lastMsgIndex];
    const mediaContent = this.buildMediaContent(media, files);

    if (mediaContent.length > 0) {
      messages[lastMsgIndex] = {
        ...lastMsg,
        content: this.buildMultimodalContent(lastMsg.content, mediaContent)
      };
    }

    return messages;
  }

  /**
   * 构建媒体内容数组
   */
  private buildMediaContent(
    media?: string[],
    files?: InboundFile[]
  ): Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }> {
    const content: Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }> = [];

    if (media) {
      for (const url of media) {
        content.push({ type: 'image_url', image_url: { url } });
      }
    }

    if (files) {
      for (const file of files) {
        if (file.localPath && this.isVisionableFile(file)) {
          content.push({ type: 'image_url', image_url: { url: `file://${file.localPath}` } });
        }
      }
    }

    return content;
  }

  /**
   * 构建多模态内容
   */
  private buildMultimodalContent(
    originalContent: string | Array<any>,
    mediaContent: Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>
  ): Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }> {
    const content: Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }> = [];

    // 添加原始文本内容
    if (typeof originalContent === 'string') {
      content.push({ type: 'text', text: originalContent });
    } else if (Array.isArray(originalContent)) {
      // 如果原内容已经是数组，添加所有文本项
      for (const item of originalContent) {
        if (item.type === 'text' && item.text) {
          content.push({ type: 'text', text: item.text });
        }
      }
    }

    // 添加媒体内容
    content.push(...mediaContent);

    return content;
  }

  /**
   * 执行 Agent 任务（核心 LLM + 工具循环）
   */
  async execute(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options?: ExecuteOptions
  ): Promise<AgentResult> {
    const toolsUsed: string[] = [];
    const max = options?.maxIterations ?? this.maxIterations;
    const allowTools = options?.allowTools ?? true;
    const source = options?.source ?? 'user';
    let agentMode = false;

    for (let i = 0; i < max; i++) {
      const tools = allowTools ? this.toolRegistry.getDefinitions() : [];

      if (i === 0 && tools.length > 0) {
        this.log.debug(`First round: ${tools.length} tools available`);
      }

      // 获取 reasoning 配置
      const reasoning = this.visionSettings?.reasoning || false;

      const response = await this.provider.chat(messages, tools, this.model, { reasoning });

      // Record token usage metrics and stats
      if (response.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
        metrics.record('llm.tokens.prompt', prompt_tokens, 'count', { source });
        metrics.record('llm.tokens.completion', completion_tokens, 'count', { source });
        metrics.record('llm.tokens.total', total_tokens, 'count', { source });
        tokenStats.record(prompt_tokens, completion_tokens, total_tokens);
      }

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
          this.log.debug(`Tool call ID: ${toolCall.id}, raw arguments type: ${typeof toolCall.arguments}`);

          const toolEndTimer = metrics.timer('agent.tool_execution', { tool: toolName });
          let result: string;

          try {
            let execToolName = toolName;
            if (execToolName.includes(':')) {
              execToolName = execToolName.replace(':', '_mcp_');
            }

            const execContext = { ...toolContext, source };

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
        return { content: response.content || '', reasoning_content: response.reasoning_content, toolsUsed, agentMode };
      }
    }

    this.log.warn(`Reached max iterations (${max}), tools used: ${toolsUsed.join(', ') || 'none'}`);
    return { content: '已达到最大迭代次数', reasoning_content: undefined, toolsUsed, agentMode };
  }

  /**
   * 直接调用 LLM（供插件使用）
   */
  async callLLM(
    messages: LLMMessage[],
    options?: { allowTools?: boolean; maxIterations?: number }
  ): Promise<{ content: string; reasoning_content?: string }> {
    // 检查是否需要使用视觉模型
    const hasVisionContent = this.hasVisionContentInMessages(messages);
    if (hasVisionContent && this.visionProvider) {
      const visionModel = this.visionSettings?.visionModelName || this.visionProvider.getDefaultModel();
      this.log.info(`callLLM: Using vision model: ${visionModel}`);
      const tools = options?.allowTools !== false ? this.toolRegistry.getDefinitions() : [];
      const response = await this.visionProvider.chat(messages, tools, visionModel);
      return { content: response.content || '', reasoning_content: response.reasoning_content };
    }

    const tools = options?.allowTools !== false ? this.toolRegistry.getDefinitions() : [];
    const reasoning = this.visionSettings?.reasoning || false;
    const response = await this.provider.chat(messages, tools, this.model, { reasoning });
    return { content: response.content || '', reasoning_content: response.reasoning_content };
  }

  /**
   * 检查消息中是否包含视觉内容
   */
  private hasVisionContentInMessages(messages: LLMMessage[]): boolean {
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const content of msg.content) {
          if (content.type === 'image_url') {
            return true;
          }
        }
      }
    }
    return false;
  }

  buildContext(history: any[], currentMessage: string, media?: string[], files?: InboundFile[]): LLMMessage[] {
    return this.contextBuilder.build(history, currentMessage, media, files);
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
