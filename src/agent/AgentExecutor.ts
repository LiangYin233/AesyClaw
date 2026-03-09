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
  sessionKey?: string;
}

export interface BackgroundResultState {
  messages: LLMMessage[];
  toolContext: ToolContext;
  startIndex: number;
}

export interface ExecuteBackgroundOptions extends ExecuteOptions {
  onNeedsBackground?: (
    response: LLMResponse,
    messages: LLMMessage[],
    toolContext: ToolContext
  ) => Promise<void>;
}

export interface AgentResult {
  content: string;
  reasoning_content?: string;
  toolsUsed: string[];
  agentMode: boolean;
  needsBackground?: boolean;
  backgroundState?: BackgroundResultState;
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
  private abortControllers: Map<string, AbortController> = new Map();

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
   * 创建指定会话的中止控制器
   */
  private createAbortController(sessionKey: string): AbortController {
    const controller = new AbortController();
    this.abortControllers.set(sessionKey, controller);
    controller.signal.addEventListener('abort', () => {
      this.abortControllers.delete(sessionKey);
    });
    return controller;
  }

  /**
   * 获取指定会话的中止信号
   */
  getAbortSignal(sessionKey: string): AbortSignal | undefined {
    return this.abortControllers.get(sessionKey)?.signal;
  }

  /**
   * 中止指定会话的执行
   */
  abort(sessionKey: string): void {
    const controller = this.abortControllers.get(sessionKey);
    if (controller) {
      controller.abort();
      this.log.info(`Aborted session: ${sessionKey}`);
    }
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
    const sessionKey = options?.sessionKey;
    let agentMode = false;

    // 创建中止控制器（如果提供了 sessionKey）
    let abortController: AbortController | undefined;
    if (sessionKey) {
      abortController = this.createAbortController(sessionKey);
    }

    // 检查是否已被中止
    const checkAbort = () => {
      if (abortController?.signal.aborted) {
        throw new Error('Execution aborted');
      }
    };

    for (let i = 0; i < max; i++) {
      checkAbort();

      const tools = allowTools ? this.toolRegistry.getDefinitions() : [];

      const response = await provider.chat(messages, tools, model, { signal: abortController?.signal });

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
          // 检查是否已被中止
          checkAbort();

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

            const execContext = { ...toolContext, source, signal: abortController?.signal };

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
    const sessionKey = options?.sessionKey;
    let agentMode = false;

    // 创建中止控制器（如果提供了 sessionKey）
    let abortController: AbortController | undefined;
    if (sessionKey) {
      abortController = this.createAbortController(sessionKey);
    }

    // 检查是否已被中止
    const checkAbort = () => {
      if (abortController?.signal.aborted) {
        throw new Error('Execution aborted');
      }
    };

    for (let i = 0; i < max; i++) {
      checkAbort();

      const tools = allowTools ? this.toolRegistry.getDefinitions() : [];

      if (i === 0 && tools.length > 0) {
        this.log.debug(`First round: ${tools.length} tools available`);
      }

      // 获取 reasoning 配置
      const reasoning = this.visionSettings?.reasoning || false;

      const response = await this.provider.chat(messages, tools, this.model, { reasoning, signal: abortController?.signal });

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
          // 检查是否已被中止
          checkAbort();

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

            const execContext = { ...toolContext, source, signal: abortController?.signal };

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
   * 执行一轮 LLM，如果需要工具执行则触发后台回调
   * 返回包含 needsBackground 标记的结果，告知调用者需要后台执行
   */
  async executeWithBackground(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options?: ExecuteBackgroundOptions
  ): Promise<AgentResult & { needsBackground?: boolean; backgroundState?: BackgroundResultState }> {
    const tools = options?.allowTools !== false ? this.toolRegistry.getDefinitions() : [];
    const sessionKey = options?.sessionKey;

    // 创建中止控制器
    let abortController: AbortController | undefined;
    if (sessionKey) {
      abortController = this.createAbortController(sessionKey);
    }

    // 检查是否已被中止
    const checkAbort = () => {
      if (abortController?.signal.aborted) {
        throw new Error('Execution aborted');
      }
    };
    checkAbort();

    const reasoning = this.visionSettings?.reasoning || false;
    const response = await this.provider.chat(messages, tools, this.model, { reasoning, signal: abortController?.signal });

    // 没有 toolCalls，同步返回
    if (response.toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: response.content || '' });
      return {
        content: response.content || '',
        reasoning_content: response.reasoning_content,
        toolsUsed: [],
        agentMode: false,
        needsBackground: false
      };
    }

    // 有 toolCalls，将 assistant 消息添加到 messages 中
    messages.push({
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls
    });

    // 触发后台回调并立即返回
    if (options?.onNeedsBackground) {
      await options.onNeedsBackground(response, messages, toolContext);
    }

    // 返回标记，告知需要后台执行完整的工具循环
    return {
      content: response.content || '',
      reasoning_content: response.reasoning_content,
      toolsUsed: [],
      agentMode: true,
      needsBackground: true,
      backgroundState: {
        messages,
        toolContext,
        startIndex: messages.length - response.toolCalls.length
      }
    };
  }

  /**
   * 在后台执行完整的工具循环（供 BackgroundTaskManager 调用）
   * 从第一次 toolCalls 开始执行，不需要再次调用 LLM
   */
  async executeToolLoop(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options?: ExecuteOptions & { initialToolCalls?: any[] }
  ): Promise<AgentResult> {
    const toolsUsed: string[] = [];
    const max = options?.maxIterations ?? this.maxIterations;
    const allowTools = options?.allowTools ?? true;
    const source = options?.source ?? 'user';
    const sessionKey = options?.sessionKey;
    const initialToolCalls = options?.initialToolCalls;
    let agentMode = true; // 已经有 toolCalls，所以是 agent 模式

    // 创建中止控制器
    let abortController: AbortController | undefined;
    if (sessionKey) {
      abortController = this.createAbortController(sessionKey);
    }

    // 检查是否已被中止
    const checkAbort = () => {
      if (abortController?.signal.aborted) {
        throw new Error('Execution aborted');
      }
    };

    // 如果有初始 toolCalls，先执行它们
    let toolCallQueue = [...(initialToolCalls || [])];
    let iteration = 0;

    while (toolCallQueue.length > 0 && iteration < max) {
      iteration++;
      checkAbort();

      // 执行当前队列中的所有 toolCalls
      for (const toolCall of toolCallQueue) {
        checkAbort();

        const toolName = toolCall.name;

        if (!toolName) {
          this.log.error(`Tool name is undefined, toolCall: ${JSON.stringify(toolCall).substring(0, 200)}`);
          continue;
        }

        toolsUsed.push(toolName);
        this.log.info(`[Background] Executing tool: ${toolName}`);

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
          this.log.info(`[Background] Tool ${toolName} executed successfully, result length: ${result.length}`);

          if (this.pluginManager) {
            result = await this.pluginManager.applyOnToolCall(toolName, toolArgs, result);
          }

          metrics.record('agent.tool_call_count', 1, 'count', { tool: toolName, status: 'success' });
        } catch (error: unknown) {
          const { normalizeError, isRetryableError } = await import('../logger/index.js');
          const message = normalizeError(error);
          const isRetryable = isRetryableError(error);
          result = `Error: ${message}${isRetryable ? ' (retryable)' : ''}`;
          this.log.error(`[Background] Tool ${toolName} execution failed:`, message);

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

      // 执行完所有 toolCalls 后，继续调用 LLM 获取下一轮响应
      checkAbort();

      const tools = allowTools ? this.toolRegistry.getDefinitions() : [];
      const reasoning = this.visionSettings?.reasoning || false;
      const response = await this.provider.chat(messages, tools, this.model, { reasoning, signal: abortController?.signal });

      if (response.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
        metrics.record('llm.tokens.prompt', prompt_tokens, 'count', { source });
        metrics.record('llm.tokens.completion', completion_tokens, 'count', { source });
        metrics.record('llm.tokens.total', total_tokens, 'count', { source });
        tokenStats.record(prompt_tokens, completion_tokens, total_tokens);
      }

      if (response.toolCalls.length > 0) {
        // 继续循环，执行下一轮 toolCalls
        messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls
        });
        toolCallQueue = response.toolCalls;
      } else {
        // 没有更多 toolCalls，任务完成
        this.log.info(`[Background] LLM response complete, no more tool calls`);
        messages.push({ role: 'assistant', content: response.content || '' });
        return { content: response.content || '', reasoning_content: response.reasoning_content, toolsUsed, agentMode };
      }
    }

    if (toolCallQueue.length > 0) {
      this.log.warn(`[Background] Reached max iterations (${max})`);
      return { content: '已达到最大迭代次数', reasoning_content: undefined, toolsUsed, agentMode };
    }

    // 正常结束 - 提取文本内容
    const lastMessage = messages[messages.length - 1];
    const lastContent = typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : lastMessage?.content?.find(c => c.type === 'text')?.text || '';
    return { content: lastContent, reasoning_content: undefined, toolsUsed, agentMode };
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
