import type { LLMMessage, InboundMessage, ToolDefinition, OutboundMessage, ToolCall, LLMResponse, PluginErrorContext } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import type { LLMProvider } from '../providers/base.js';
import type { ToolRegistry, ToolContext } from '../tools/ToolRegistry.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { PluginManager } from '../plugins/index.js';
import { logger } from '../logger/index.js';
import { CONSTANTS } from '../constants/index.js';

export type ContextMode = 'session' | 'channel' | 'global';

interface OpenAIToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string | Record<string, any>;
  };
}

function getToolCallName(toolCall: ToolCall | OpenAIToolCall): string | undefined {
  return (toolCall as any).name ?? (toolCall as any).function?.name;
}

function getToolCallArguments(toolCall: ToolCall | OpenAIToolCall): Record<string, any> | undefined {
  const args = (toolCall as any).arguments ?? (toolCall as any).function?.arguments;
  return typeof args === 'string' ? JSON.parse(args || '{}') : args;
}

export class ContextBuilder {
  private workspace: string;
  private systemPrompt: string;

  constructor(workspace: string, systemPrompt?: string) {
    this.workspace = workspace;
    this.systemPrompt = systemPrompt || 'You are a helpful AI assistant.';
  }

  build(
    history: any[],
    currentMessage: string,
    channel?: string,
    chatId?: string
  ): LLMMessage[] {
    const messages: LLMMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
      ...history.filter(m => ['user', 'assistant', 'system'].includes(m.role)),
      { role: 'user', content: this.buildUserContent(currentMessage, channel, chatId) }
    ];
    return messages;
  }

  private buildSystemPrompt(): string {
    const now = new Date();
    let prompt = this.systemPrompt
      .replace(/\{\{\s*current_time\s*\}\}/g, now.toISOString())
      .replace(/\{\{\s*current_date\s*\}\}/g, now.toLocaleString())
      .replace(/\{\{\s*current_hour\s*\}\}/g, now.toLocaleTimeString())
      .replace(/\{\{\s*timezone\s*\}\}/g, Intl.DateTimeFormat().resolvedOptions().timeZone);

    return `# AesyClaw\n\n${prompt}\n\n## Workspace: ${this.workspace}`;
  }

  private buildUserContent(message: string, channel?: string, chatId?: string): string {
    const ctx = [
      `[Runtime Context]`,
      channel && `Channel: ${channel}`,
      chatId && `Chat ID: ${chatId}`,
      `Time: ${new Date().toISOString()}`
    ].filter(Boolean).join('\n');

    return `${ctx}\n\n${message}`;
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
  private log = logger.child({ prefix: 'Agent' });

  constructor(
    eventBus: EventBus,
    provider: LLMProvider,
    toolRegistry: ToolRegistry,
    sessionManager: SessionManager,
    workspace: string,
    systemPrompt?: string,
    maxIterations: number = CONSTANTS.DEFAULT_MAX_ITERATIONS,
    model: string = 'gpt-4o',
    contextMode: ContextMode = 'channel',
    memoryWindow: number = CONSTANTS.DEFAULT_MEMORY_WINDOW
  ) {
    this.eventBus = eventBus;
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.sessionManager = sessionManager;
    this.contextBuilder = new ContextBuilder(workspace, systemPrompt);
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
    if (this.pluginManager) {
      const cmdResult = await this.pluginManager.applyOnCommand(msg);
      if (cmdResult !== null) {
        msg = cmdResult;
        if (msg.replyOnly) {
          await this.eventBus.publishOutbound({
            channel: msg.channel,
            chatId: msg.chatId,
            content: msg.content,
            messageType: msg.messageType
          });
          return;
        }
      }

      const handled = await this.pluginManager.applyOnMessage(msg);
      if (handled === null) {
        this.log.debug('Message handled by plugin, skipping');
        return;
      }
      msg = handled;
    }
    
    if (msg.replyOnly) {
      await this.eventBus.publishOutbound({
        channel: msg.channel,
        chatId: msg.chatId,
        content: msg.content,
        messageType: msg.messageType
      });
      return;
    }
    
    const channelChatKey = `${msg.channel}:${msg.chatId}`;
    
    if (msg.content.trim() === '/new') {
      const newSessionKey = this.sessionManager.createNewSession(msg.channel, msg.chatId);
      this.channelSessions.set(channelChatKey, newSessionKey);
      this.log.info(`Created new session: ${newSessionKey}`);
      
      await this.eventBus.publishOutbound({
        channel: msg.channel,
        chatId: msg.chatId,
        content: '已开启新对话',
        messageType: msg.messageType
      });
      return;
    }

    let sessionKey: string;
    if (msg.sessionKey) {
      sessionKey = msg.sessionKey;
    } else if (this.contextMode === 'channel') {
      sessionKey = this.channelSessions.get(channelChatKey) || this.sessionManager.createSessionKey(msg.channel, msg.chatId);
      this.channelSessions.set(channelChatKey, sessionKey);
    } else if (this.contextMode === 'global') {
      sessionKey = 'global';
    } else {
      sessionKey = this.sessionManager.createSessionKey(msg.channel, msg.chatId);
    }

    this.log.debug(`Processing message for session: ${sessionKey} (mode: ${this.contextMode})`);
    const session = await this.sessionManager.getOrCreate(sessionKey);
    this.log.debug(`Session messages count: ${session.messages.length}`);

    const historyMessages = session.messages.slice(-this.memoryWindow);
    const messages = this.contextBuilder.build(
      historyMessages,
      msg.content,
      msg.channel,
      msg.chatId
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

    let outboundMsg: OutboundMessage = {
      channel: msg.channel,
      chatId: msg.chatId,
      content: result.content,
      reasoning_content: result.reasoning_content,
      messageType: msg.messageType
    };

    if (this.pluginManager) {
      this.log.info(`Applying ${this.pluginManager.listPlugins().length} plugins on response...`);
      outboundMsg = await this.pluginManager.applyOnResponse(outboundMsg) || outboundMsg;
      this.log.info(`After plugin processing, media: ${JSON.stringify(outboundMsg.media)}`);
    }

    this.log.debug(`Publishing outbound message to ${msg.channel}:${msg.chatId}`);
    await this.eventBus.publishOutbound(outboundMsg);
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
          let toolName = getToolCallName(toolCall);
          
          if (!toolName) {
            const toolCallStr = JSON.stringify(toolCall).substring(0, 200);
            this.log.error(`Tool name is undefined, toolCall: ${toolCallStr}`);
            continue;
          }
          
          toolsUsed.push(toolName);
          this.log.info(`Executing tool: ${toolName}`);
          
          let toolArgs = getToolCallArguments(toolCall);
          
          if (!toolArgs) {
            this.log.warn(`Tool arguments is undefined for ${toolName}`);
            toolArgs = {};
          }
          
          this.log.info(`Tool ${toolName} arguments: ${JSON.stringify(toolArgs)}`);
          
          let result: string;

          try {
            let execToolName = toolName;
            if (execToolName.includes(':')) {
              execToolName = `mcp_${execToolName}`;
            }
            
            const toolArgsStr = JSON.stringify(toolArgs).substring(0, 200);
            this.log.debug(`Tool args: ${toolArgsStr}`);
            
            const execContext = {
              ...this.toolContext,
              source: source
            };
            result = await this.toolRegistry.execute(
              toolName,
              toolArgs || {},
              execContext
            );
            this.log.info(`Tool ${toolName} executed successfully, result length: ${result.length}`);
            const resultPreview = result.substring(0, CONSTANTS.MESSAGE_TRUNCATE_LENGTH);
            this.log.debug(`Tool ${toolName} result preview: ${resultPreview}`);

            if (this.pluginManager) {
              result = await this.pluginManager.applyOnToolCall(toolName, toolArgs || {}, result);
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            const isRetryable = this.isRetryableError(error);
            result = `Error: ${message}${isRetryable ? ' (retryable)' : ''}`;
            this.log.error(`Tool ${toolName} execution failed (retryable: ${isRetryable}):`, message);

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
      content,
      'cli',
      'direct'
    );

    const result = await this.runAgentLoop(messages);

    await this.sessionManager.addMessage(sessionKey, 'user', content);
    await this.sessionManager.addMessage(sessionKey, 'assistant', result.content);
    await this.sessionManager.save(session);

    return result.content;
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.toolRegistry.getDefinitions();
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

  private isRetryableError(error: unknown): boolean {
    if (!error) return false;
    
    const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
    
    if (error instanceof Error) {
      const message = error.message;
      const networkPatterns = [
        'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 
        'network', 'timeout', 'ECONNRESET', 'socket'
      ];
      
      if (networkPatterns.some(pattern => message.includes(pattern))) {
        return true;
      }
      
      const statusMatch = message.match(/\b(40[89]|5\d{2})\b/);
      if (statusMatch && retryableStatusCodes.includes(parseInt(statusMatch[1], 10))) {
        return true;
      }
    }
    
    return false;
  }
}
