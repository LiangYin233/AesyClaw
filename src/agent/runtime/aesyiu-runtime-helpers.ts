import { randomUUID } from 'crypto';
import {
  AgentContext,
  AesyiuEngine,
  AnthropicProvider,
  MemoryManager,
  OpenAICompletionProvider,
  OpenAIResponsesProvider,
  type AgentSkill,
  type Message as AesyiuMessage,
  type ModelDefinition,
  type Tool as AesyiuTool,
} from 'aesyiu';
import { getHookRuntime } from '@/bootstrap.js';
import { configManager } from '@/features/config/config-manager.js';
import type { ProvidersConfig } from '@/features/config/schema.js';
import { buildHookSkills, buildHookTools } from '@/features/plugins/hook-utils.js';
import type { HookPayloadLLMSkill, HookPayloadLLMTool } from '@/features/plugins/types.js';
import { roleManager } from '@/features/roles/role-manager.js';
import { SUBAGENT_TOOL_NAME_RUN } from '@/agent/subagent/types.js';
import { LLMProviderType, MessageRole, type LLMConfig, type StandardMessage } from '@/platform/llm/types.js';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import type { ITool, ToolExecuteContext, ToolExecutionResult } from '@/platform/tools/types.js';

export interface AesyiuRunStats {
  steps: number;
  toolCalls: number;
  error?: string;
}

type RolePromptMeta = NonNullable<AesyiuMessage['_meta']> & { rolePrompt?: boolean };

function parseToolArguments(argumentsText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsText);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function toAesyiuMessage(message: StandardMessage): AesyiuMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCalls && message.toolCalls.length > 0
      ? {
          tool_calls: message.toolCalls.map(toolCall => ({
            id: toolCall.id,
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments ?? {}),
          })),
        }
      : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
  };
}

export function toStandardMessage(message: AesyiuMessage): StandardMessage {
  return {
    role: message.role as MessageRole,
    content: message.content ?? '',
    ...(message.tool_calls && message.tool_calls.length > 0
      ? {
          toolCalls: message.tool_calls.map(toolCall => ({
            id: toolCall.id,
            name: toolCall.name,
            arguments: parseToolArguments(toolCall.arguments),
          })),
        }
      : {}),
    ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}),
  };
}

export function getFinalAssistantText(messages: readonly AesyiuMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'assistant' && !message.tool_calls?.length) {
      return message.content ?? '';
    }
  }

  return '';
}

function createRolesPromptMessage(tools: readonly ITool[]): AesyiuMessage | null {
  if (!tools.some(tool => tool.name === SUBAGENT_TOOL_NAME_RUN)) {
    return null;
  }

  const roles = roleManager.getRolesList();
  if (roles.length === 0) {
    return null;
  }

  const listing = roles
    .map(role => `- ${role.id}: ${role.name}${role.description ? ` - ${role.description}` : ''}`)
    .join('\n');

  return {
    role: 'system',
    content: [
      'Available roles:',
      listing,
      'If a task matches one of these roles, call `runSubAgent` with one of the listed role IDs only.',
    ].join('\n'),
    _meta: {
      isPinned: true,
      rolePrompt: true,
    } as RolePromptMeta,
  };
}

export function isRolePromptMessage(message: AesyiuMessage): boolean {
  return Boolean((message._meta as RolePromptMeta | undefined)?.rolePrompt);
}

function resolveModelDefinition(
  modelId: string,
  providers: ProvidersConfig,
  contextLimit: number
): ModelDefinition {
  for (const providerConfig of Object.values(providers)) {
    if (!providerConfig.models) {
      continue;
    }

    for (const modelConfig of Object.values(providerConfig.models)) {
      if (modelConfig.modelname === modelId) {
        const contextWindow = Math.min(modelConfig.contextWindow, contextLimit);
        return {
          id: modelConfig.modelname,
          contextWindow,
          maxOutputTokens: Math.min(16384, contextWindow),
        };
      }
    }
  }

  return {
    id: modelId,
    contextWindow: contextLimit,
    maxOutputTokens: Math.min(16384, contextLimit),
  };
}

function createHookAwareProvider(
  llmConfig: LLMConfig,
  modelDef: ModelDefinition,
  stats: Pick<AesyiuRunStats, 'steps' | 'error'>,
  hookTools: HookPayloadLLMTool[],
  hookSkills: HookPayloadLLMSkill[]
) {
  const providerConfig = {
    apiKey: llmConfig.apiKey || '',
    baseURL: llmConfig.baseUrl,
  };

  const provider = (() => {
    switch (llmConfig.provider) {
      case LLMProviderType.OpenAICompletion:
        return new OpenAICompletionProvider(providerConfig, [modelDef]);
      case LLMProviderType.Anthropic:
        return new AnthropicProvider(providerConfig, [modelDef]);
      case LLMProviderType.OpenAIChat:
      default:
        return new OpenAIResponsesProvider(providerConfig, [modelDef]);
    }
  })();

  const originalGenerate = provider.generate.bind(provider);
  provider.generate = async (activeModel, messages, tools) => {
    stats.steps += 1;

    try {
      const beforeLLMResult = await getHookRuntime().dispatchBeforeLLMRequest({
        messages: messages.map(toStandardMessage),
        tools: hookTools,
        skills: hookSkills,
      });

      if (beforeLLMResult.blocked) {
        throw new Error(beforeLLMResult.reason || 'LLM request blocked by plugin hook');
      }
    } catch (error) {
      stats.error = toErrorMessage(error);
      throw error;
    }

    try {
      return await originalGenerate(activeModel, messages, tools);
    } catch (error) {
      stats.error = toErrorMessage(error);
      throw error;
    }
  };

  return provider;
}

function createHookAwareRunTools(
  tools: readonly ITool[],
  stats: Pick<AesyiuRunStats, 'toolCalls'>,
  options: {
    createToolContext: (_ctx: unknown, _tool: ITool) => ToolExecuteContext;
    checkToolAllowed?: (_tool: ITool) => ToolExecutionResult | null;
  }
): AesyiuTool[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.getDefinition().parameters,
    execute: async (args, ctx) => {
      const syntheticToolCallId = randomUUID();
      const parsedArgs = args && typeof args === 'object' ? args as Record<string, unknown> : {};
      const rejectedResult = options.checkToolAllowed?.(tool);

      if (rejectedResult) {
        logger.info(
          {
            toolName: tool.name,
            toolCallId: syntheticToolCallId,
            args: parsedArgs,
            success: rejectedResult.success,
            error: rejectedResult.error,
          },
          'Tool call rejected before execution'
        );
        return rejectedResult;
      }

      const toolContext = options.createToolContext(ctx, tool);

      stats.toolCalls += 1;

      logger.info(
        {
          toolName: tool.name,
          toolCallId: syntheticToolCallId,
          args: parsedArgs,
          chatId: toolContext.chatId,
          traceId: toolContext.traceId,
          roleId: toolContext.roleId,
        },
        'Starting tool execution via aesyiu runtime'
      );

      const beforeToolResult = await getHookRuntime().dispatchBeforeToolCall({
        id: syntheticToolCallId,
        name: tool.name,
        arguments: parsedArgs,
      });

      let toolResult: ToolExecutionResult;

      if (beforeToolResult.shortCircuited) {
        toolResult = beforeToolResult.result;
        logger.info(
          {
            toolName: tool.name,
            toolCallId: syntheticToolCallId,
            chatId: toolContext.chatId,
            traceId: toolContext.traceId,
          },
          'Tool execution short-circuited by hook'
        );
      } else {
        toolResult = await tool.execute(parsedArgs, toolContext);
      }

      const finalResult = await getHookRuntime().dispatchAfterToolCall({
        toolCall: {
          id: syntheticToolCallId,
          name: tool.name,
          arguments: parsedArgs,
        },
        result: toolResult,
      });

      logger.info(
        {
          toolName: tool.name,
          toolCallId: syntheticToolCallId,
          chatId: toolContext.chatId,
          traceId: toolContext.traceId,
          success: finalResult.success,
          error: finalResult.error,
        },
        'Tool execution completed via aesyiu runtime'
      );

      return finalResult;
    },
  }));
}

interface BuildAesyiuEngineOptions {
  chatId: string;
  traceId: string;
  llmConfig: LLMConfig;
  maxContextTokens: number;
  compressionThreshold: number;
  maxSteps: number;
  filteredTools: ITool[];
  allowedSkills: AgentSkill[];
  messages: AesyiuMessage[];
  stats: AesyiuRunStats;
  createToolContext: (_ctx: unknown, _tool: ITool) => ToolExecuteContext;
  checkToolAllowed?: (_tool: ITool) => ToolExecutionResult | null;
}

export function buildAesyiuEngine(options: BuildAesyiuEngineOptions): {
  engine: AesyiuEngine;
  context: AgentContext;
} {
  const toolDefs = options.filteredTools.map(tool => tool.getDefinition());
  const hookSkills = buildHookSkills(options.allowedSkills);
  const hookTools = buildHookTools(toolDefs, options.allowedSkills);

  const modelDef = resolveModelDefinition(
    options.llmConfig.model || 'gpt-4o-mini',
    configManager.config.providers,
    options.maxContextTokens
  );
  const provider = createHookAwareProvider(options.llmConfig, modelDef, options.stats, hookTools, hookSkills);

  const context = new AgentContext({ provider, modelId: options.llmConfig.model });
  context.state.chatId = options.chatId;
  context.state.traceId = options.traceId;
  context.addMessages(options.messages);

  const rolesPrompt = createRolesPromptMessage(options.filteredTools);
  if (rolesPrompt) context.addMessage(rolesPrompt);

  const engine = new AesyiuEngine({
    maxSteps: options.maxSteps,
    compatibilityMode: true,
    memoryManager: new MemoryManager({
      compressThresholdRatio: options.compressionThreshold,
      retainLatestMessages: 8,
    }),
  });

  const runTools = createHookAwareRunTools(options.filteredTools, options.stats, {
    createToolContext: options.createToolContext,
    checkToolAllowed: options.checkToolAllowed,
  });
  for (const tool of runTools) engine.registerTool(tool);
  engine.registerSkills(options.allowedSkills);

  return { engine, context };
}
