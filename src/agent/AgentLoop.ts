import type { LLMMessage, InboundMessage, OutboundMessage, LLMResponse } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import type { LLMProvider } from '../providers/base.js';
import type { ToolRegistry, ToolContext } from '../tools/ToolRegistry.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { PluginManager } from '../plugins/index.js';
import { SkillManager } from '../skills/index.js';
import { CommandRegistry } from './commands/index.js';
import { AgentExecutor } from './AgentExecutor.js';
import { logger } from '../logger/index.js';
import { metrics } from '../logger/Metrics.js';
import { CONFIG_DEFAULTS } from '../constants/index.js';
import { shouldSkipLLM, getSkipReason } from '../plugins/IntentHelpers.js';

export type ContextMode = 'session' | 'channel' | 'global';

export class AgentLoop {
  private eventBus: EventBus;
  private sessionManager: SessionManager;
  private executor: AgentExecutor;
  private running = false;
  private toolContext: ToolContext;
  private contextMode: ContextMode;
  private memoryWindow: number;
  private channelSessions: Map<string, string> = new Map();
  private pluginManager?: PluginManager;
  private commandRegistry?: CommandRegistry;
  private log = logger.child({ prefix: 'Agent' });

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
    this.sessionManager = sessionManager;
    this.contextMode = contextMode;
    this.memoryWindow = memoryWindow;
    this.toolContext = { workspace, eventBus };

    const skillsPrompt = skillManager?.buildSkillsPrompt() || '';
    this.executor = new AgentExecutor(
      provider, toolRegistry, workspace,
      systemPrompt, skillsPrompt, model, maxIterations
    );

    this.log.info(`Initialized with model: ${model}, contextMode: ${contextMode}`);
  }

  setPluginManager(pm: PluginManager): void {
    this.pluginManager = pm;
    this.executor.setPluginManager(pm);
    this.log.info('PluginManager attached');
  }

  setSkillManager(sm: SkillManager): void {
    this.executor.setSkillsPrompt(sm.buildSkillsPrompt());
    this.log.info('SkillManager attached');
  }

  async callLLM(
    messages: LLMMessage[],
    options?: { allowTools?: boolean; maxIterations?: number }
  ): Promise<{ content: string; reasoning_content?: string }> {
    this.log.info(`[LLM_CALL] AgentLoop.callLLM() called with ${messages.length} messages, allowTools=${options?.allowTools ?? true}`);
    const result = await this.executor.callLLM(messages, options);
    this.log.info(`[LLM_CALL] AgentLoop.callLLM() returned, content length=${result.content.length}`);
    return result;
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

      this.toolContext = {
        ...this.toolContext,
        channel: msg.channel,
        chatId: msg.chatId,
        messageType: msg.messageType
      };

      const channelChatKey = `${msg.channel}:${msg.chatId}`;

      // 1. 内置命令
      if (this.commandRegistry) {
        const cmdResult = await this.commandRegistry.execute(msg);
        if (cmdResult !== null) {
          this.log.info('Built-in command executed');
          await this.sendOutbound({ channel: cmdResult.channel, chatId: cmdResult.chatId, content: cmdResult.content, messageType: cmdResult.messageType });
          return;
        }
      }

      // 2. 插件命令
      if (this.pluginManager) {
        const cmdResult = await this.pluginManager.applyOnCommand(msg);
        if (cmdResult !== null) {
          await this.sendOutbound({ channel: cmdResult.channel, chatId: cmdResult.chatId, content: cmdResult.content, messageType: cmdResult.messageType });
          return;
        }

        // 3. 插件消息钩子
        const handled = await this.pluginManager.applyOnMessage(msg);
        if (handled === null) {
          this.log.debug('Message handled by plugin (null), skipping');
          return;
        }

        // 如果插件设置了跳过 LLM 的意图，直接发送回复
        if (shouldSkipLLM(handled)) {
          const reason = getSkipReason(handled);
          this.log.info(`Skipping LLM processing: ${reason}`);
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

      // Set current context for system prompt
      this.executor.getContextBuilder().setCurrentContext(msg.channel, msg.chatId, msg.messageType);

      // 将已下载的文件路径追加到消息内容
      if (msg.files && msg.files.length > 0) {
        const savedPaths = msg.files.filter(f => f.localPath).map(f => f.localPath!);
        if (savedPaths.length > 0) {
          const note = savedPaths.map(p => `[文件已保存至: ${p}]`).join('\n');
          msg = { ...msg, content: msg.content ? `${msg.content}\n${note}` : note };
        }
      }

      const messages = this.executor.buildContext(
        session.messages.slice(-this.memoryWindow),
        msg.content,
        msg.media
      );

      if (this.pluginManager) {
        await this.pluginManager.applyOnAgentBefore(msg, messages);
      }

      this.log.info(`[LLM_CALL] AgentLoop.processMessage() calling executor.execute() with ${messages.length} messages`);
      const result = await this.executor.execute(messages, this.toolContext, {
        allowTools: true,
        source: 'user'
      });
      this.log.info(`[LLM_CALL] AgentLoop.processMessage() executor.execute() returned, content length=${result.content.length}`);

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

      await this.sendOutbound({
        channel: msg.channel,
        chatId: msg.chatId,
        content: result.content,
        reasoning_content: result.reasoning_content,
        messageType: msg.messageType
      });

      metrics.record('agent.message_count', 1, 'count', { status: 'success' });
    } catch (error) {
      metrics.record('agent.message_count', 1, 'count', { status: 'error' });
      throw error;
    } finally {
      endTimer();
    }
  }

  async processDirect(
    content: string,
    sessionKey: string,
    contextOverride?: Partial<ToolContext>
  ): Promise<string> {
    const session = await this.sessionManager.getOrCreate(sessionKey);
    const originalContext = { ...this.toolContext };

    if (contextOverride) {
      this.toolContext = { ...this.toolContext, ...contextOverride };
    }

    try {
      const messages = this.executor.buildContext(session.messages, content);
      const result = await this.executor.execute(messages, this.toolContext);

      await this.sessionManager.addMessage(sessionKey, 'user', content);
      await this.sessionManager.addMessage(sessionKey, 'assistant', result.content);
      await this.sessionManager.save(session);

      return result.content;
    } finally {
      this.toolContext = originalContext;
    }
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  updateProvider(provider: LLMProvider, model?: string): void {
    this.executor.updateProvider(provider, model);
    this.log.info(model ? `Provider and model updated: ${model}` : 'Provider updated');
  }

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
