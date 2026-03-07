import type { LLMMessage, InboundMessage, OutboundMessage, ToolCall, LLMResponse, PluginErrorContext } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import type { LLMProvider } from '../providers/base.js';
import type { ToolRegistry, ToolContext } from '../tools/ToolRegistry.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { PluginManager } from '../plugins/index.js';
import { SkillManager, type SkillContext, type SkillResult } from '../skills/index.js';
import { CommandRegistry } from './commands/index.js';
import { logger } from '../logger/index.js';
import { metrics } from '../logger/Metrics.js';
import { CONSTANTS, CONFIG_DEFAULTS } from '../constants/index.js';
import { normalizeError, isRetryableError } from '../utils/index.js';

export type ContextMode = 'session' | 'channel' | 'global';  // 上下文模式类型

export class ContextBuilder {  // 上下文构建器
  private workspace: string;
  private systemPrompt: string;
  private skillsPrompt: string;

  constructor(workspace: string, systemPrompt?: string, skillsPrompt?: string) {
    this.workspace = workspace;
    this.systemPrompt = systemPrompt || 'You are a helpful AI assistant.';
    this.skillsPrompt = skillsPrompt || '';
  }

  setSkillsPrompt(prompt: string): void {
    this.skillsPrompt = prompt;
  }

  build(  // 构建消息上下文
    history: any[],
    currentMessage: string,
    media?: string[]  // 新增 media 参数
  ): LLMMessage[] {
    const messages: LLMMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
      ...history.filter(m => ['user', 'assistant', 'system'].includes(m.role)),
      { role: 'user', content: this.buildUserContent(currentMessage, media) }
    ];
    return messages;
  }

  private buildSystemPrompt(): string {
    const now = new Date();
    let prompt = this.systemPrompt
      .replace(/\{\{\s*current_time\s*\}\}/g, now.toISOString())
      .replace(/\{\{\s*current_date\s*\}\}/g, now.toLocaleString())
      .replace(/\{\{\s*current_hour\s*\}\}/g, now.toLocaleTimeString())
      .replace(/\{\{\s*timezone\s*\}\}/g, Intl.DateTimeFormat().resolvedOptions().timeZone)
      .replace(/\{\{\s*cwd\s*\}\}/g, this.workspace)
      .replace(/\{\{\s*os\s*\}\}/g, process.platform);

    const sections = [`# AesyClaw`, prompt, `## Workspace: ${this.workspace}`];

    // 添加 skills 部分（如果存在）
    if (this.skillsPrompt) {
      sections.push(this.skillsPrompt);
    }

    return sections.join('\n\n');
  }

  private buildUserContent(
    message: string,
    media?: string[]  // 新增 media 参数
  ): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
    // 如果有图片，构建多模态消息
    if (media && media.length > 0) {
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: 'text', text: message }
      ];

      // 添加图片
      for (const imageUrl of media) {
        content.push({
          type: 'image_url',
          image_url: { url: imageUrl }
        });
      }

      return content;
    }

    // 纯文本消息
    return message;
  }
}

export class AgentLoop {
  private eventBus: EventBus;
  private provider: LLMProvider;
  private toolRegistry: ToolRegistry;
  private sessionManager: SessionManager;
  private contextBuilder: ContextBuilder;
  private running = false;
  private maxIterations: number;
  private toolContext: ToolContext;
  private model: string;
  private contextMode: ContextMode;
  private memoryWindow: number;
  private channelSessions: Map<string, string> = new Map();
  private pluginManager?: PluginManager;
  private commandRegistry?: CommandRegistry;
  private log = logger.child({ prefix: 'Agent' });

  async callLLM(  // 供插件调用的 LLM 请求方法
    messages: LLMMessage[],
    options?: { allowTools?: boolean; maxIterations?: number }
  ): Promise<{ content: string; reasoning_content?: string }> {
    const tools = options?.allowTools !== false ? this.toolRegistry.getDefinitions() : [];
    const response = await this.provider.chat(messages, tools, this.model);
    return {
      content: response.content || '',
      reasoning_content: response.reasoning_content
    };
  }

  constructor(
    eventBus: EventBus,
    provider: LLMProvider,
    toolRegistry: ToolRegistry,
    sessionManager: SessionManager,
    workspace: string,
    systemPrompt?: string,
    maxIterations: number = CONFIG_DEFAULTS.DEFAULT_MAX_ITERATIONS,
    model: string = 'gpt-4o',
    contextMode: ContextMode = 'channel',
    memoryWindow: number = CONFIG_DEFAULTS.DEFAULT_MEMORY_WINDOW,
    skillManager?: SkillManager
  ) {
    this.eventBus = eventBus;
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.sessionManager = sessionManager;

    // 构建 skills prompt
    const skillsPrompt = skillManager?.buildSkillsPrompt() || '';

    this.contextBuilder = new ContextBuilder(workspace, systemPrompt, skillsPrompt);
    this.maxIterations = maxIterations;
    this.toolContext = { workspace, eventBus };
    this.model = model;
    this.contextMode = contextMode;
    this.memoryWindow = memoryWindow;
    this.log.info(`Initialized with model: ${this.model}, contextMode: ${this.contextMode}`);
  }

  setPluginManager(pm: PluginManager): void {
    this.pluginManager = pm;
    this.log.info('PluginManager attached');
  }

  setSkillManager(sm: SkillManager): void {
    // 更新 ContextBuilder 的 skills prompt
    this.contextBuilder.setSkillsPrompt(sm.buildSkillsPrompt());
    this.log.info('SkillManager attached');
  }

  async run(): Promise<void> {
    this.running = true;
    this.log.info('Loop started, waiting for messages...');

    while (this.running) {
      try {
        const msg = await this.eventBus.consumeInbound();
        this.log.debug(`Received message from ${msg.channel}:${msg.chatId}, content: ${msg.content.slice(0, 50)}...`);
        await this.processMessage(msg);
      } catch (error) {
        if (this.running) {
          this.log.error('Error:', error);
        }
      }
    }
  }

  private async processMessage(msg: InboundMessage): Promise<void> {
    const endTimer = metrics.timer('agent.process_message', {
      channel: msg.channel,
      sessionKey: msg.sessionKey || 'unknown'
    });

    try {
      this.log.info(`processMessage: content="${msg.content}", media=${JSON.stringify(msg.media)}`);

    // 更新 toolContext 以包含当前会话信息
    this.toolContext = {
      ...this.toolContext,
      channel: msg.channel,
      chatId: msg.chatId,
      messageType: msg.messageType
    };

    this.log.info(`[AgentLoop] toolContext updated: channel=${this.toolContext.channel}, chatId=${this.toolContext.chatId}, messageType=${this.toolContext.messageType}`);

    const channelChatKey = `${msg.channel}:${msg.chatId}`;

    // 1. 检查内置命令（最高优先级）
    if (this.commandRegistry) {
      const cmdResult = await this.commandRegistry.execute(msg);
      if (cmdResult !== null) {
        this.log.info('Built-in command executed');
        await this.sendOutbound({
          channel: cmdResult.channel,
          chatId: cmdResult.chatId,
          content: cmdResult.content,
          messageType: cmdResult.messageType
        });
        return;
      }
    }

    // 2. 检查插件命令
    if (this.pluginManager) {
      this.log.info('Calling applyOnCommand...');
      const cmdResult = await this.pluginManager.applyOnCommand(msg);
      this.log.info(`applyOnCommand returned: ${cmdResult}`);
      if (cmdResult !== null) {
        // 命令已处理，发送回复并跳过 LLM
        await this.sendOutbound({
          channel: cmdResult.channel,
          chatId: cmdResult.chatId,
          content: cmdResult.content,
          messageType: cmdResult.messageType
        });
        return;
      }

      // 3. 应用插件消息钩子
      this.log.info('Calling applyOnMessage...');
      const handled = await this.pluginManager.applyOnMessage(msg);
      if (handled === null) {
        this.log.debug('Message handled by plugin (null), skipping');
        return;
      }

      // onMessage 返回了不同的消息（插件要发送回复）
      if (handled.content !== msg.content) {
        this.log.info('Plugin modified message, sending reply and skipping LLM');
        await this.sendOutbound({
          channel: handled.channel,
          chatId: handled.chatId,
          content: handled.content,
          messageType: handled.messageType
        });
        return;
      }

      msg = handled;
    }

    let sessionKey: string;
    if (msg.sessionKey) {
      sessionKey = msg.sessionKey;
    } else if (this.contextMode === 'channel') {
      sessionKey = this.channelSessions.get(channelChatKey) || this.sessionManager.createNewSession(msg.channel, msg.chatId);
      this.channelSessions.set(channelChatKey, sessionKey);
    } else if (this.contextMode === 'global') {
      sessionKey = 'global';
    } else {
      sessionKey = this.sessionManager.createNewSession(msg.channel, msg.chatId);
    }

    this.log.debug(`Processing message for session: ${sessionKey} (mode: ${this.contextMode})`);
    const session = await this.sessionManager.getOrCreate(sessionKey);
    this.log.debug(`Session messages count: ${session.messages.length}`);

    const historyMessages = session.messages.slice(-this.memoryWindow);
    const messages = this.contextBuilder.build(
      historyMessages,
      msg.content,
      msg.media  // 传递 media 字段
    );

    if (this.pluginManager) {
      await this.pluginManager.applyOnAgentBefore(msg, messages);
    }

    this.log.debug(`Calling LLM with ${messages.length} messages`);
    const result = await this.runAgentLoop(messages, undefined, {
      allowTools: true,
      source: 'user'
    });

    const llmResponse: LLMResponse = {
      content: result.content,
      reasoning_content: result.reasoning_content,
      toolCalls: [],
      finishReason: result.agentMode ? 'max_iterations' : 'stop'
    };

    if (this.pluginManager) {
      await this.pluginManager.applyOnAgentAfter(msg, llmResponse);
    }

    this.log.debug(`LLM response: ${result.content.slice(0, 100)}...`);
    this.log.debug(`Tools used: ${result.toolsUsed.join(', ') || '(none)'}, agentMode: ${result.agentMode}`);

    await this.sessionManager.addMessage(sessionKey, 'user', msg.content);
    await this.sessionManager.addMessage(sessionKey, 'assistant', result.content);
    await this.sessionManager.save(session);

    const outboundMsg: OutboundMessage = {
      channel: msg.channel,
      chatId: msg.chatId,
      content: result.content,
      reasoning_content: result.reasoning_content,
      messageType: msg.messageType
    };

    this.log.debug(`Publishing outbound message to ${msg.channel}:${msg.chatId}`);
    await this.sendOutbound(outboundMsg);

    // 记录消息处理成功
    metrics.record('agent.message_count', 1, 'count', { status: 'success' });
  } catch (error) {
    // 记录消息处理失败
    metrics.record('agent.message_count', 1, 'count', { status: 'error' });
    throw error;
  } finally {
    endTimer();
  }
}

  private async runAgentLoop(
    messages: LLMMessage[],
    maxIterations?: number,
    options?: { allowTools: boolean; source: 'user' | 'cron' }
  ): Promise<{ content: string; reasoning_content?: string; toolsUsed: string[]; agentMode: boolean }> {
    const toolsUsed: string[] = [];
    const max = maxIterations || this.maxIterations;
    const allowTools = options?.allowTools ?? true;
    const source = options?.source ?? 'user';
    let agentMode = false;

    for (let i = 0; i < max; i++) {
      const tools = allowTools ? this.toolRegistry.getDefinitions(agentMode) : [];

      if (i === 0 && tools.length > 0) {
        this.log.debug(`First round: ${tools.length} tools available (excluding agent-only)`);
      }

      const response = await this.provider.chat(
        messages,
        tools,
        this.model
      );

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
            const toolCallStr = JSON.stringify(toolCall).substring(0, 200);
            this.log.error(`Tool name is undefined, toolCall: ${toolCallStr}`);
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

            const toolArgsStr = JSON.stringify(toolArgs).substring(0, 200);
            this.log.debug(`Tool args: ${toolArgsStr}`);

            const execContext = {
              ...this.toolContext,
              source: source
            };

            this.log.info(`[AgentLoop] execContext for ${toolName}: channel=${execContext.channel}, chatId=${execContext.chatId}, messageType=${execContext.messageType}, keys=${Object.keys(execContext).join(',')}`);

            if (this.pluginManager) {
              toolArgs = await this.pluginManager.applyOnBeforeToolCall(toolName, toolArgs || {}, execContext);
              this.log.debug(`After plugin hooks, tool args: ${JSON.stringify(toolArgs).substring(0, 200)}`);
            }

            result = await this.toolRegistry.execute(
              execToolName,
              toolArgs || {},
              execContext
            );
            this.log.info(`Tool ${toolName} executed successfully, result length: ${result.length}`);
            const resultPreview = result.substring(0, CONSTANTS.MESSAGE_TRUNCATE_LENGTH);
            this.log.debug(`Tool ${toolName} result preview: ${resultPreview}`);

            if (this.pluginManager) {
              result = await this.pluginManager.applyOnToolCall(toolName, toolArgs || {}, result);
            }

            // 记录工具调用成功
            metrics.record('agent.tool_call_count', 1, 'count', { tool: toolName, status: 'success' });
          } catch (error: unknown) {
            const message = normalizeError(error);
            const isRetryable = isRetryableError(error);
            result = `Error: ${message}${isRetryable ? ' (retryable)' : ''}`;
            this.log.error(`Tool ${toolName} execution failed (retryable: ${isRetryable}):`, message);

            // 记录工具调用失败
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
        messages.push({
          role: 'assistant',
          content: response.content || ''
        });

        return { content: response.content || '', reasoning_content: response.reasoning_content, toolsUsed, agentMode };
      }
    }

    return {
      content: '已达到最大迭代次数',
      reasoning_content: undefined,
      toolsUsed,
      agentMode
    };
  }

  /**
   * Process a direct message from API or CLI.
   * @param content - The message content to process
   * @param sessionKey - The session key for context
   * @returns The agent's response as a string
   */
  async processDirect(
    content: string,
    sessionKey: string
  ): Promise<string> {
    const session = await this.sessionManager.getOrCreate(sessionKey);
    const messages = this.contextBuilder.build(
      session.messages,
      content
    );

    const result = await this.runAgentLoop(messages);

    await this.sessionManager.addMessage(sessionKey, 'user', content);
    await this.sessionManager.addMessage(sessionKey, 'assistant', result.content);
    await this.sessionManager.save(session);

    return result.content;
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  updateProvider(provider: LLMProvider, model?: string): void {
    this.provider = provider;
    if (model) {
      this.model = model;
      this.log.info(`Provider and model updated: ${model}`);
    } else {
      this.log.info('Provider updated');
    }
  }

  /**
   * Send an outbound message through plugin hooks and publish to EventBus
   */
  private async sendOutbound(msg: OutboundMessage): Promise<void> {
    let processedMsg = msg;

    if (this.pluginManager) {
      this.log.debug(`Applying onResponse hooks before publishing`);
      processedMsg = await this.pluginManager.applyOnResponse(msg) || msg;
    }

    await this.eventBus.publishOutbound(processedMsg);
  }

  setCommandRegistry(registry: CommandRegistry): void {
    this.commandRegistry = registry;
    this.log.info('CommandRegistry attached');
  }
}
