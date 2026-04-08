import { StandardMessage, MessageRole, LLMProviderType } from '../../agent/llm/types.js';
import { LLMConfig, createLLMSession } from '../../agent/llm/factory.js';
import { buildPromptContext } from '../../agent/llm/prompt-context-factory.js';
import { ToolRegistry } from '../../platform/tools/registry.js';
import { ToolDefinition, ToolExecuteContext } from '../../platform/tools/types.js';
import { logger } from '../../platform/observability/logger.js';
import { roleManager, DEFAULT_ROLE_ID } from '../roles/role-manager.js';
import { configManager } from '../config/config-manager.js';
import { resolveLLMConfig } from '../../middlewares/agent.middleware.js';
import type { SandboxConfig, SubAgentResult, SandboxContext } from './types.js';

export class SandboxEngine {
  private static activeSandboxes: Map<string, SandboxContext> = new Map();

  private sandboxId: string;
  private parentChatId: string;
  private config: SandboxConfig;
  private agentId: string;
  private memory: StandardMessage[] = [];
  private maxSteps: number = 10;

  constructor(parentChatId: string, config: SandboxConfig) {
    this.sandboxId = `sandbox_${parentChatId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.parentChatId = parentChatId;
    this.config = config;
    this.agentId = `subagent_${this.sandboxId}`;

    this.initializeMemory();

    SandboxEngine.activeSandboxes.set(this.sandboxId, {
      sandboxId: this.sandboxId,
      parentChatId: this.parentChatId,
      config: this.config,
      messages: this.memory,
      createdAt: new Date(),
    });

    logger.info(
      { 
        sandboxId: this.sandboxId,
        parentChatId: this.parentChatId,
        roleId: config.roleId || 'temp',
        toolCount: config.allowedTools.length
      },
      ' SandboxEngine created'
    );
  }

  private initializeMemory(): void {
    const toolPermissionText = this.config.allowedTools.includes('*') 
      ? '你有权限使用所有工具。' 
      : `你只能使用以下工具: ${this.config.allowedTools.join(', ')}。`;

    const taskDescription = this.getTaskFromConfig();
    
    const fullSystemPrompt = `${this.config.systemPrompt}\n\n${toolPermissionText}\n\n任务：${taskDescription}`;

    this.memory = [
      {
        role: MessageRole.System,
        content: fullSystemPrompt,
      },
    ];
  }

  private getTaskFromConfig(): string {
    if (this.config.roleId) {
      const role = roleManager.getRole(this.config.roleId);
      return role?.name 
        ? `你当前扮演的是【${role.name}】角色。\n\n任务要求：\n${this.extractTaskDescription()}`
        : this.extractTaskDescription();
    }
    return this.extractTaskDescription();
  }

  private extractTaskDescription(): string {
    const systemPrompt = this.config.systemPrompt;
    const taskMatch = systemPrompt.match(/任务[：:]\s*(.+?)(?:\n|$)/i);
    if (taskMatch) {
      return taskMatch[1];
    }
    return '执行指定任务';
  }

  private getFilteredTools(): ToolDefinition[] {
    const toolRegistry = ToolRegistry.getInstance();
    const allTools = toolRegistry.getAllToolDefinitions();

    if (this.config.allowedTools.includes('*')) {
      return allTools;
    }

    return allTools.filter(tool => this.config.allowedTools.includes(tool.name));
  }

  async execute(): Promise<SubAgentResult> {
    const startTime = Date.now();

    logger.info(
      { sandboxId: this.sandboxId },
      '🔄 Starting sub-agent execution'
    );

    try {
      const filteredTools = this.getFilteredTools();
      const llmConfig = this.getLLMConfig();

      const context: ToolExecuteContext = {
        chatId: this.agentId,
        senderId: 'subagent',
        traceId: this.sandboxId,
      };

      const session = createLLMSession(llmConfig, filteredTools);

      for (const msg of this.memory) {
        if (msg.role === MessageRole.System) {
          continue;
        }
        session.addMessage(msg);
      }

      let step = 0;
      let lastAssistantMessage = '';

      while (step < this.maxSteps) {
        step++;

        logger.debug(
          { sandboxId: this.sandboxId, step },
          'Sub-agent thinking...'
        );

        const promptContext = buildPromptContext({
          chatId: this.sandboxId,
          senderId: 'sandbox',
          roleId: this.config.roleId || DEFAULT_ROLE_ID,
          messages: this.memory,
          tools: filteredTools,
        });

        const response = await session.generate(promptContext);

        if (response.finishReason === 'error') {
          throw new Error('LLM 返回错误');
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
          for (const toolCall of response.toolCalls) {
            const toolResult = await this.executeTool(toolCall, context);
            session.addToolResult(toolCall.id, toolCall.name, toolResult.content);
            this.memory.push({
              role: MessageRole.Tool,
              content: toolResult.content,
              toolCallId: toolCall.id,
              name: toolCall.name,
            });
          }
          continue;
        }

        if (response.text) {
          lastAssistantMessage = response.text;
          break;
        }
      }

      if (!lastAssistantMessage) {
        lastAssistantMessage = '[无输出] 子代理未能产生有效输出';
      }

      const executionTime = Date.now() - startTime;

      logger.info(
        { 
          sandboxId: this.sandboxId,
          steps: step,
          executionTime,
          outputLength: lastAssistantMessage.length
        },
        'Sub-agent execution completed'
      );

      this.destroy();

      return {
        success: true,
        finalText: lastAssistantMessage,
        roleId: this.config.roleId || 'temp',
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(
        { sandboxId: this.sandboxId, error },
        '❌ Sub-agent execution failed'
      );

      this.destroy();

      return {
        success: false,
        finalText: '',
        roleId: this.config.roleId || 'temp',
        executionTime,
        error: errorMessage,
      };
    }
  }

  private getLLMConfig(): LLMConfig {
    try {
      const config = configManager.config;
      const defaultRole = roleManager.getRoleConfig(DEFAULT_ROLE_ID);
      const modelIdentifier = defaultRole.model;
      return resolveLLMConfig(modelIdentifier, config);
    } catch (error) {
      logger.warn({ error }, 'Failed to resolve LLM config from config.json, using fallback');
      return {
        provider: LLMProviderType.OpenAIChat,
        model: 'gpt-4o-mini',
      };
    }
  }

  private async executeTool(
    toolCall: { id: string; name: string; arguments: Record<string, unknown> },
    context: ToolExecuteContext
  ): Promise<{ success: boolean; content: string; error?: string }> {
    if (!this.config.allowedTools.includes('*') && !this.config.allowedTools.includes(toolCall.name)) {
      return {
        success: false,
        content: '',
        error: `工具 "${toolCall.name}" 不在允许列表中`,
      };
    }

    try {
      const toolRegistry = ToolRegistry.getInstance();
      const results = await toolRegistry.executeTools(
        [{ id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments }],
        context
      );

      return results[0];
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  destroy(): void {
    SandboxEngine.activeSandboxes.delete(this.sandboxId);
    this.memory = [];
    
    logger.debug({ sandboxId: this.sandboxId }, 'Sandbox destroyed');
  }
}
