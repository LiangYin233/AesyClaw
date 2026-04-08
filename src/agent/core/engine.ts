import {
  StandardMessage,
  MessageRole,
} from '../llm/types.js';
import { LLMConfig, LLMSession, createLLMSession } from '../llm/factory.js';
import { buildPromptContext } from '../llm/prompt-context-factory.js';
import { ToolRegistry } from '../../platform/tools/registry.js';
import { MessageFactory } from './message-factory.js';
import {
  ToolDefinition,
  ToolExecuteContext,
  ToolCallRequest,
} from '../../platform/tools/types.js';
import { logger } from '../../platform/observability/logger.js';
import { pluginManager } from '../../features/plugins/plugin-manager.js';
import { roleManager } from '../../features/roles/role-manager.js';
import {
  SessionMemoryManager,
  MemoryConfig,
} from './memory/index.js';

export interface AgentConfig {
  llm: LLMConfig;
  maxSteps?: number;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  memoryConfig?: Partial<MemoryConfig>;
}

export interface AgentRunResult {
  success: boolean;
  finalText: string;
  steps: number;
  toolCalls: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
}

export class AgentEngine {
  readonly chatId: string;
  private instanceId: string;
  private config: Required<AgentConfig>;
  private session: LLMSession | null = null;
  private toolRegistry: ToolRegistry;
  private tools: ToolDefinition[];
  private maxSteps: number;
  private memory: SessionMemoryManager;

  constructor(chatId: string, config: AgentConfig) {
    this.chatId = chatId;
    this.instanceId = `agent-${chatId}-${Date.now()}`;
    this.config = {
      maxSteps: config.maxSteps || 15,
      systemPrompt: config.systemPrompt || '你是一个有帮助的AI助手。',
      tools: config.tools || [],
      llm: config.llm,
      memoryConfig: config.memoryConfig || {},
    };

    this.toolRegistry = ToolRegistry.getInstance();
    this.tools = this.config.tools;
    this.maxSteps = this.config.maxSteps;
    
    this.memory = new SessionMemoryManager(chatId, this.config.memoryConfig);
    
    if (!this.memory.hasMessages() && this.config.systemPrompt) {
      this.memory.addMessage(MessageFactory.createSystemMessage(this.config.systemPrompt));
    }

    logger.info(
      { 
        chatId: this.chatId, 
        instanceId: this.instanceId,
        model: this.config.llm.model,
        maxSteps: this.maxSteps,
        toolCount: this.tools.length,
        memoryConfig: this.config.memoryConfig,
      },
      '🤖 AgentEngine 实例已创建（集成记忆系统）'
    );
  }

  private getSession(): LLMSession {
    if (!this.session) {
      const filteredTools = this.getFilteredTools();
      this.session = createLLMSession(this.config.llm, filteredTools);

      logger.debug(
        { 
          chatId: this.chatId,
          totalTools: this.toolRegistry.getAllToolDefinitions().length,
          filteredTools: filteredTools.length,
          roleId: this.memory.getActiveRoleId()
        },
        'LLM Session created with role-filtered tools'
      );
    }
    return this.session;
  }

  async run(userInput: string): Promise<AgentRunResult> {
    logger.info(
      { chatId: this.chatId, instanceId: this.instanceId, inputLength: userInput.length },
      'AgentEngine starting request processing'
    );

    this.memory.addMessage(MessageFactory.createUserMessage(userInput));

    const session = this.getSession();

    const context: ToolExecuteContext = {
      chatId: this.chatId,
      senderId: 'user',
      traceId: this.instanceId,
    };

    let step = 0;
    let totalToolCalls = 0;
    let finalText = '';

    try {
      while (step < this.maxSteps) {
        step++;
        logger.info(
          { chatId: this.chatId, step, maxSteps: this.maxSteps },
          `Starting step ${step}`
        );

        const filteredTools = this.getFilteredTools();

        const currentMessages = this.memory.getMessages();

        await pluginManager.dispatchBeforeLLMRequest({
          messages: currentMessages,
          tools: filteredTools,
        });

        const promptContext = this.buildPromptContextForCurrentState(currentMessages, filteredTools);

        const response = await session.generate(promptContext);

        if (response.finishReason === 'error') {
          throw new Error('LLM returned error');
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
          totalToolCalls += response.toolCalls.length;

          const toolNames = response.toolCalls.map(tc => tc.name).join(', ');
          logger.info(
            { chatId: this.chatId, step, toolCallCount: response.toolCalls.length, toolNames },
            'Tool calls detected'
          );

          const assistantMessage = MessageFactory.createAssistantMessage(
            response.text || '',
            response.toolCalls
          );
          this.memory.addMessage(assistantMessage);
          session.addMessage(assistantMessage);
          
          logger.info(
            { 
              addedToMemory: true, 
              toolCallsCount: response.toolCalls.length,
              toolCallNames: response.toolCalls.map(tc => tc.name).join(',')
            },
            'Assistant 消息已添加到 memory'
          );
          
          const recentTools = this.memory.getMessages().slice(-10).filter(m => m.role === MessageRole.Tool);
          const recentToolNames = recentTools.map(m => m.name);
          if (recentToolNames.length > 0) {
            logger.info(
              { chatId: this.chatId, recentToolCalls: recentToolNames.join(', ') },
              'Recent tool calls in memory'
            );
          }

          const toolRequests: ToolCallRequest[] = response.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          }));

          for (const toolRequest of toolRequests) {
            const roleId = this.memory.getActiveRoleId();
            if (!roleManager.isToolAllowed(roleId, toolRequest.name)) {
              logger.warn(
                { toolName: toolRequest.name, roleId },
                'Tool blocked by role permission'
              );

              const toolMessage = MessageFactory.createToolMessage(
                toolRequest.id,
                toolRequest.name,
                `[权限拒绝] 角色 "${roleId}" 不允许使用工具 "${toolRequest.name}"。`
              );
              this.memory.addMessage(toolMessage);
              session.addToolResult(toolRequest.id, toolRequest.name, toolMessage.content);
              continue;
            }

            let toolResult = await pluginManager.dispatchBeforeToolCall({
              id: toolRequest.id,
              name: toolRequest.name,
              arguments: toolRequest.arguments,
            });

            if (!toolResult) {
              const results = await this.toolRegistry.executeTools([toolRequest], context);
              toolResult = {
                success: results[0].success,
                content: results[0].content,
                error: results[0].error,
              };
            }

            const afterResult = await pluginManager.dispatchAfterToolCall({
              toolCall: {
                id: toolRequest.id,
                name: toolRequest.name,
                arguments: toolRequest.arguments,
              },
              result: toolResult,
            });

            const toolMessage = MessageFactory.createToolMessage(
              toolRequest.id,
              toolRequest.name,
              afterResult.content
            );
            this.memory.addMessage(toolMessage);
            session.addToolResult(toolRequest.id, toolRequest.name, afterResult.content);
            
            logger.info(
              { toolName: toolRequest.name, contentPreview: afterResult.content.substring(0, 200) },
              '工具返回内容'
            );
            
            const currentMessages = this.memory.getMessages();
            logger.info(
              { totalMessages: currentMessages.length, lastMessageRole: currentMessages[currentMessages.length - 1]?.role },
              '添加工具结果后的 memory 状态'
            );
          }

          continue;
        }

        finalText = response.text;
        
        this.memory.addMessage(MessageFactory.createAssistantMessage(finalText));
        
        logger.info(
          { chatId: this.chatId, step, responseLength: finalText.length },
          'LLM 推理完成，无更多工具调用'
        );
        break;
      }

      if (step >= this.maxSteps) {
        logger.warn(
          { chatId: this.chatId, steps: step },
          '达到最大推理步数限制'
        );
        finalText = `抱歉，任务在 ${this.maxSteps} 步后仍未完成。请简化您的请求或分步进行。`;
      }

      const tokenUsage = session.getTotalTokenUsage();

      logger.info(
        { 
          chatId: this.chatId, 
          instanceId: this.instanceId,
          steps: step,
          toolCalls: totalToolCalls,
          tokenUsage,
        },
        'AgentEngine 任务完成'
      );

      return {
        success: true,
        finalText,
        steps: step,
        toolCalls: totalToolCalls,
        tokenUsage,
      };
    } catch (error) {
      logger.error(
        { chatId: this.chatId, instanceId: this.instanceId, error },
        '❌ AgentEngine 执行出错'
      );

      return {
        success: false,
        finalText: `执行错误: ${error instanceof Error ? error.message : '未知错误'}`,
        steps: step,
        toolCalls: totalToolCalls,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getChatId(): string {
    return this.chatId;
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  getHistory(): StandardMessage[] {
    return this.memory.getMessages();
  }

  clearHistory(): void {
    this.memory.clear();
    this.session = null;
    logger.debug({ chatId: this.chatId }, 'Agent history cleared');
  }

  getMemoryStats() {
    return this.memory.getStats();
  }

  getTokenBudget() {
    return this.memory.checkBudget();
  }

  isMemoryCompressing(): boolean {
    return this.memory.isCompressing();
  }

  getMemoryCompressionPhase() {
    return this.memory.getCurrentPhase();
  }

  private getFilteredTools(): ToolDefinition[] {
    const roleId = this.memory.getActiveRoleId();
    const allToolDefs = this.toolRegistry.getAllToolDefinitions();
    const toolNames = allToolDefs.map(t => t.name);
    const allowedToolNames = roleManager.getAllowedTools(roleId, toolNames);

    return allToolDefs.filter(tool => allowedToolNames.includes(tool.name));
  }

  private buildPromptContextForCurrentState(messages: StandardMessage[], tools: ToolDefinition[]) {
    const roleId = this.memory.getActiveRoleId();

    return buildPromptContext({
      chatId: this.chatId,
      senderId: 'user',
      roleId: roleId,
      messages: messages,
      tools: tools
    });
  }

  updateModel(model: string): void {
    this.config.llm.model = model;
    this.session = null;
    logger.info({ chatId: this.chatId, model }, 'Agent model updated');
  }

  getCurrentRoleId(): string {
    return this.memory.getActiveRoleId();
  }
}
