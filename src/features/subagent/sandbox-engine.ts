import { StandardMessage, MessageRole, LLMProviderType } from '../../agent/llm/types.js';
import { LLMConfig } from '../../agent/llm/factory.js';
import { ToolRegistry } from '../../platform/tools/registry.js';
import { ToolDefinition, ToolExecuteContext } from '../../platform/tools/types.js';
import { logger } from '../../platform/observability/logger.js';
import { roleManager } from '../roles/role-manager.js';
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
      '🚀 SandboxEngine created'
    );
  }

  private initializeMemory(): void {
    this.memory = [
      {
        role: MessageRole.System,
        content: this.config.systemPrompt,
      },
      {
        role: MessageRole.User,
        content: this.config.allowedTools.includes('*') 
          ? '你有权限使用所有工具。' 
          : `你只能使用以下工具: ${this.config.allowedTools.join(', ')}。`,
      },
      {
        role: MessageRole.User,
        content: `【任务】\n${this.getTaskFromConfig()}`,
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
      const llmConfig: LLMConfig = {
        provider: LLMProviderType.OpenAIChat,
        model: 'gpt-4o-mini',
      };

      const context: ToolExecuteContext = {
        chatId: this.agentId,
        senderId: 'subagent',
        traceId: this.sandboxId,
      };

      let step = 0;
      let lastAssistantMessage = '';

      while (step < this.maxSteps) {
        step++;

        logger.debug(
          { sandboxId: this.sandboxId, step },
          'Sub-agent thinking...'
        );

        const prompt = this.buildPrompt();

        const response = await this.callLLM(prompt, llmConfig, filteredTools);

        if (response.toolCalls && response.toolCalls.length > 0) {
          for (const toolCall of response.toolCalls) {
            const toolResult = await this.executeTool(toolCall, context);
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

        step++;
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
        '✅ Sub-agent execution completed'
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

  private buildPrompt(): string {
    let prompt = '';

    for (const msg of this.memory) {
      if (msg.role === MessageRole.System) {
        continue;
      }
      prompt += `${this.formatRole(msg.role)}: ${msg.content}\n\n`;
    }

    return prompt.trim();
  }

  private formatRole(role: MessageRole): string {
    switch (role) {
      case MessageRole.User: return 'User';
      case MessageRole.Assistant: return 'Assistant';
      case MessageRole.Tool: return 'System';
      default: return 'System';
    }
  }

  private async callLLM(
    prompt: string,
    config: LLMConfig,
    tools: ToolDefinition[]
  ): Promise<{ text?: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY || ''}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: this.config.systemPrompt },
          ...this.memory.slice(2).map(msg => ({
            role: msg.role === MessageRole.Tool ? 'tool' : msg.role,
            content: msg.content,
            ...(msg.toolCallId ? { tool_call_id: msg.toolCallId } : {}),
          })),
        ],
        tools: tools.length > 0 ? tools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })) : undefined,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;

    if (!message) {
      throw new Error('No response from LLM');
    }

    const result: { text?: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> } = {};

    if (message.content) {
      result.text = message.content;
    }

    if (message.tool_calls && message.tool_calls.length > 0) {
      result.toolCalls = message.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      }));
    }

    return result;
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
    
    logger.debug({ sandboxId: this.sandboxId }, '🗑️ Sandbox destroyed');
  }

  static getActiveSandbox(sandboxId: string): SandboxContext | undefined {
    return SandboxEngine.activeSandboxes.get(sandboxId);
  }

  static getActiveCount(): number {
    return SandboxEngine.activeSandboxes.size;
  }

  static getActiveSandboxes(): SandboxContext[] {
    return Array.from(SandboxEngine.activeSandboxes.values());
  }
}
