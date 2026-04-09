import {
  StandardMessage,
  MessageRole,
  UnifiedLLMClientConfig,
  UnifiedRequestOptions,
} from '../llm/types.js';
import { LLMConfig } from '../llm/factory.js';
import { UnifiedLLMClient } from '../llm/unified-client.js';
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
import { LLMProviderType } from '../llm/types.js';

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
  private client: UnifiedLLMClient | null = null;
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

    this.toolRegistry = new ToolRegistry();
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

  /**
   * 获取或创建 UnifiedLLMClient 实例
   */
  private getClient(): UnifiedLLMClient {
    if (!this.client) {
      const filteredTools = this.getFilteredTools();
      
      // 构建 UnifiedLLMClient 配置
      const clientConfig: UnifiedLLMClientConfig = {
        provider: this.config.llm.provider as LLMProviderType,
        model: this.config.llm.model || 'gpt-4o-mini',
        apiKey: this.config.llm.apiKey,
        baseUrl: this.config.llm.baseUrl,
        timeout: this.config.llm.timeout,
        cacheEnabled: false, // AgentEngine 默认不启用缓存，避免工具调用结果缓存
        streamEnabled: false,
      };

      this.client = new UnifiedLLMClient(clientConfig);

      logger.debug(
        { 
          chatId: this.chatId,
          totalTools: this.toolRegistry.getAllToolDefinitions().length,
          filteredTools: filteredTools.length,
          roleId: this.memory.getActiveRoleId()
        },
        'UnifiedLLMClient created with role-filtered tools'
      );
    }
    return this.client;
  }

  async run(userInput: string): Promise<AgentRunResult> {
    logger.info(
      { chatId: this.chatId, instanceId: this.instanceId, inputLength: userInput.length },
      'AgentEngine starting request processing'
    );

    await this.memory.addMessage(MessageFactory.createUserMessage(userInput));

    const client = this.getClient();

    const context: ToolExecuteContext = {
      chatId: this.chatId,
      senderId: 'user',
      traceId: this.instanceId,
    };

    let step = 0;
    let totalToolCalls = 0;
    let finalText = '';
    const totalTokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

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

        // 使用 UnifiedLLMClient 调用 LLM
        const response = await client.generate({
          messages: [...currentMessages],
          systemPrompt: this.config.systemPrompt,
          tools: filteredTools,
        }, {
          sessionId: this.chatId,
          userId: 'user',
          metadata: {
            traceId: this.instanceId,
            roleId: this.memory.getActiveRoleId(),
          },
        });

        if (response.finishReason === 'error') {
          throw new Error('LLM returned error');
        }

        // 累加 token 使用统计
        if (response.tokenUsage) {
          totalTokenUsage.promptTokens += response.tokenUsage.promptTokens;
          totalTokenUsage.completionTokens += response.tokenUsage.completionTokens;
          totalTokenUsage.totalTokens += response.tokenUsage.totalTokens;
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
          await this.memory.addMessage(assistantMessage);
          
          logger.info(
            { 
              addedToMemory: true, 
              toolCallsCount: response.toolCalls.length,
              toolCallNames: response.toolCalls.map(tc => tc.name).join(',')
            },
            'Assistant 消息已添加到 memory'
          );
          
          const recentTools = this.memory.getRecentMessages(10).filter(m => m.role === MessageRole.Tool);
          const recentToolNames = recentTools.map(m => m.name || '');

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
              await this.memory.addMessage(toolMessage);
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
            await this.memory.addMessage(toolMessage);
            
            logger.info(
              { toolName: toolRequest.name, contentPreview: afterResult.content.substring(0, 200) },
              '工具返回内容'
            );
            
            const totalMessages = this.memory.getMessageCount();
            const lastMessage = this.memory.getLastMessage();
            logger.info(
              { totalMessages, lastMessageRole: lastMessage?.role },
              '添加工具结果后的 memory 状态'
            );
          }

          continue;
        }

        finalText = response.text;
        
        await this.memory.addMessage(MessageFactory.createAssistantMessage(finalText));
        
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

      logger.info(
        { 
          chatId: this.chatId, 
          instanceId: this.instanceId,
          steps: step,
          toolCalls: totalToolCalls,
          tokenUsage: totalTokenUsage,
        },
        'AgentEngine 任务完成'
      );

      return {
        success: true,
        finalText,
        steps: step,
        toolCalls: totalToolCalls,
        tokenUsage: totalTokenUsage,
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

  private getFilteredTools(): ToolDefinition[] {
    const roleId = this.memory.getActiveRoleId();
    const allToolDefs = this.toolRegistry.getAllToolDefinitions();
    const toolNames = allToolDefs.map(t => t.name);
    const allowedToolNames = roleManager.getAllowedTools(roleId, toolNames);

return allToolDefs.filter(tool => allowedToolNames.includes(tool.name));
  }

  updateModel(model: string): void {
    this.config.llm.model = model;
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    logger.info({ chatId: this.chatId, model }, 'Agent model updated');
  }
}
