import { randomUUID } from 'crypto';
import {
  AgentContext,
  AesyiuEngine,
  AnthropicProvider,
  MemoryManager,
  OpenAICompletionProvider,
  OpenAIResponsesProvider,
  type AgentSkill,
  type LLMMiddleware,
  type LLMProvider,
  type Message as AesyiuMessage,
  type ModelDefinition,
  type Tool as AesyiuTool,
  type ToolMiddleware,
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
import type { Tool, ToolExecuteContext, ToolExecutionResult } from '@/platform/tools/types.js';

export interface AesyiuRunStats {
  steps: number;
  toolCalls: number;
  error?: string;
}

export const ROLES_PROMPT_SECTION = 'aesyclaw:roles';

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

function injectRolesPrompt(ctx: AgentContext, tools: readonly Tool[]): void {
  if (!tools.some(tool => tool.name === SUBAGENT_TOOL_NAME_RUN)) {
    ctx.removePromptSection(ROLES_PROMPT_SECTION);
    return;
  }

  const roles = roleManager.getRolesList();
  if (roles.length === 0) {
    ctx.removePromptSection(ROLES_PROMPT_SECTION);
    return;
  }

  const listing = roles
    .map(role => `- ${role.id}: ${role.name}${role.description ? ` - ${role.description}` : ''}`)
    .join('\n');

  const content = [
    'Available roles:',
    listing,
    'If a task matches one of these roles, call `runSubAgent` with one of the listed role IDs only.',
  ].join('\n');

  ctx.registerPromptSection(ROLES_PROMPT_SECTION, { content, pinned: true });
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

function buildProvider(llmConfig: LLMConfig, modelDef: ModelDefinition): LLMProvider {
  const providerConfig = {
    apiKey: llmConfig.apiKey || '',
    baseURL: llmConfig.baseUrl,
  };

  switch (llmConfig.provider) {
    case LLMProviderType.OpenAICompletion:
      return new OpenAICompletionProvider(providerConfig, [modelDef]);
    case LLMProviderType.Anthropic:
      return new AnthropicProvider(providerConfig, [modelDef]);
    case LLMProviderType.OpenAIChat:
    default:
      return new OpenAIResponsesProvider(providerConfig, [modelDef]);
  }
}

function createHookAwareLLMMiddleware(
  stats: Pick<AesyiuRunStats, 'steps' | 'error'>,
  hookTools: HookPayloadLLMTool[],
  hookSkills: HookPayloadLLMSkill[],
): LLMMiddleware {
  return async (ctx, next) => {
    stats.steps += 1;

    try {
      const beforeLLMResult = await getHookRuntime().dispatchBeforeLLMRequest({
        messages: ctx.messages.map(toStandardMessage),
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
      return await next();
    } catch (error) {
      stats.error = toErrorMessage(error);
      throw error;
    }
  };
}

function createHookAwareToolMiddleware(
  toolIndex: Map<string, Tool>,
  stats: Pick<AesyiuRunStats, 'toolCalls'>,
  options: {
    traceId: string;
    chatId: string;
    checkToolAllowed?: (_tool: Tool) => ToolExecutionResult | null;
    getRoleId: () => string;
  },
): ToolMiddleware {
  return async (ctx, next) => {
    const iTool = toolIndex.get(ctx.tool.name);
    if (!iTool) {
      return next();
    }

    const syntheticToolCallId = randomUUID();
    const parsedArgs = ctx.args && typeof ctx.args === 'object' ? ctx.args as Record<string, unknown> : {};
    const rejectedResult = options.checkToolAllowed?.(iTool);

    if (rejectedResult) {
      logger.info(
        {
          toolName: iTool.name,
          toolCallId: syntheticToolCallId,
          args: parsedArgs,
          success: rejectedResult.success,
          error: rejectedResult.error,
        },
        'Tool call rejected before execution'
      );
      return rejectedResult;
    }

    stats.toolCalls += 1;

    logger.info(
      {
        toolName: iTool.name,
        toolCallId: syntheticToolCallId,
        args: parsedArgs,
        chatId: options.chatId,
        traceId: options.traceId,
        roleId: options.getRoleId(),
      },
      'Starting tool execution via aesyiu runtime'
    );

    const beforeToolResult = await getHookRuntime().dispatchBeforeToolCall({
      id: syntheticToolCallId,
      name: iTool.name,
      arguments: parsedArgs,
    });

    let toolResult: ToolExecutionResult;

    if (beforeToolResult.shortCircuited) {
      toolResult = beforeToolResult.result;
      logger.info(
        {
          toolName: iTool.name,
          toolCallId: syntheticToolCallId,
          chatId: options.chatId,
          traceId: options.traceId,
        },
        'Tool execution short-circuited by hook'
      );
    } else {
      toolResult = await next() as ToolExecutionResult;
    }

    const finalResult = await getHookRuntime().dispatchAfterToolCall({
      toolCall: {
        id: syntheticToolCallId,
        name: iTool.name,
        arguments: parsedArgs,
      },
      result: toolResult,
    });

    logger.info(
      {
        toolName: iTool.name,
        toolCallId: syntheticToolCallId,
        chatId: options.chatId,
        traceId: options.traceId,
        success: finalResult.success,
        error: finalResult.error,
      },
      'Tool execution completed via aesyiu runtime'
    );

    return finalResult;
  };
}

function toAesyiuTool(
  tool: Tool,
  createToolContext: (ctx: unknown, tool: Tool) => ToolExecuteContext,
): AesyiuTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.getDefinition().parameters,
    execute: async (args, agentContext) => {
      const toolContext = createToolContext(agentContext, tool);
      return tool.execute(args as Record<string, unknown>, toolContext);
    },
  };
}

interface BuildAesyiuEngineOptions {
  chatId: string;
  traceId: string;
  llmConfig: LLMConfig;
  maxContextTokens: number;
  compressionThreshold: number;
  maxSteps: number;
  filteredTools: Tool[];
  allowedSkills: AgentSkill[];
  messages: AesyiuMessage[];
  stats: AesyiuRunStats;
  createToolContext: (_ctx: unknown, _tool: Tool) => ToolExecuteContext;
  checkToolAllowed?: (_tool: Tool) => ToolExecutionResult | null;
  getRoleId?: () => string;
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
  const provider = buildProvider(options.llmConfig, modelDef);

  const context = new AgentContext({ provider, modelId: options.llmConfig.model });
  context.state.chatId = options.chatId;
  context.state.traceId = options.traceId;
  context.addMessages(options.messages);

  injectRolesPrompt(context, options.filteredTools);

  const engine = new AesyiuEngine({
    maxSteps: options.maxSteps,
    compatibilityMode: true,
    memoryManager: new MemoryManager({
      compressThresholdRatio: options.compressionThreshold,
      retainLatestMessages: 8,
    }),
  });

  const toolIndex = new Map(options.filteredTools.map(tool => [tool.name, tool] as const));
  const getRoleId = options.getRoleId ?? (() => '');

  engine.useLLM(createHookAwareLLMMiddleware(options.stats, hookTools, hookSkills));
  engine.useTool(createHookAwareToolMiddleware(toolIndex, options.stats, {
    chatId: options.chatId,
    traceId: options.traceId,
    checkToolAllowed: options.checkToolAllowed,
    getRoleId,
  }));

  for (const tool of options.filteredTools) {
    engine.registerTool(toAesyiuTool(tool, options.createToolContext));
  }
  engine.registerSkills(options.allowedSkills);

  return { engine, context };
}
