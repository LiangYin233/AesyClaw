/** @file aesyiu 运行时辅助函数
 *
 * 提供构建 aesyiu 引擎、消息格式转换、钩子感知中间件等辅助功能。
 * aesyiu 是底层 LLM Agent 运行时库，本文件负责将其与 AesyClaw 的
 * 插件系统、角色权限、工具注册等上层概念桥接。
 */

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
  type TokenUsage,
  type Tool as AesyiuTool,
  type ToolMiddleware,
} from 'aesyiu';
import type { PluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import type { RoleCatalog } from '@/contracts/runtime-services.js';
import type { ProvidersConfig } from '@/features/config/schema.js';
import { buildHookSkills, buildHookTools } from '@/features/plugins/hook-utils.js';
import type { HookPayloadLLMSkill, HookPayloadLLMTool } from '@/features/plugins/types.js';
import { SUBAGENT_TOOL_NAME_RUN } from '@/agent/subagent/types.js';
import { LLMProviderType, MessageRole, type LLMConfig, type StandardMessage } from '@/platform/llm/types.js';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import { SESSION_MEMORY_RETAIN_LATEST_MESSAGES } from '@/agent/memory/types.js';
import {
  zodToToolParameters,
  type Tool,
  type ToolExecuteContext,
  type ToolExecutionResult,
} from '@/platform/tools/types.js';

/** Agent 运行统计 */
export interface AesyiuRunStats {
  steps: number;
  toolCalls: number;
  error?: string;
}

/** 系统提示词中的角色列表区块标识 */
export const ROLES_PROMPT_SECTION = 'aesyclaw:roles';
const TOOL_LOG_CONTENT_LIMIT = 1000;

/** 截断工具执行日志内容，防止日志过大 */
function truncateToolLogContent(content: string): string {
  if (content.length <= TOOL_LOG_CONTENT_LIMIT) {
    return content;
  }

  return `${content.slice(0, TOOL_LOG_CONTENT_LIMIT)}...[truncated ${content.length - TOOL_LOG_CONTENT_LIMIT} chars]`;
}

/** 将引擎中仍保留 Zod schema 的工具参数转换为标准 JSON Schema */
function normalizeEngineToolParameters(engine: AesyiuEngine): void {
  for (const tool of engine.getTools()) {
    const parameters = tool.parameters as unknown;
    if (
      parameters &&
      typeof parameters === 'object' &&
      'safeParse' in parameters &&
      typeof (parameters as { safeParse?: unknown }).safeParse === 'function'
    ) {
      tool.parameters = zodToToolParameters(parameters as never);
    }
  }
}

/** 检查引擎中是否存在参数未正确转换的工具 */
export function inspectEngineToolParameters(engine: AesyiuEngine): {
  toolNames: string[];
  invalidParameterTools: string[];
} {
  const tools = engine.getTools();
  return {
    toolNames: tools.map(tool => tool.name),
    invalidParameterTools: tools
      .filter(tool => {
        const parameters = tool.parameters as unknown;
        return (
          parameters &&
          typeof parameters === 'object' &&
          'safeParse' in parameters &&
          typeof (parameters as { safeParse?: unknown }).safeParse === 'function'
        );
      })
      .map(tool => tool.name),
  };
}

/** 安全解析工具参数字符串 */
function parseToolArguments(argumentsText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsText);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** 将 StandardMessage 转换为 aesyiu 消息格式 */
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

/** 将 aesyiu 消息格式转换为 StandardMessage */
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

/** 从消息列表中提取最后一条非工具调用的助手回复 */
export function getFinalAssistantText(messages: readonly AesyiuMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'assistant' && !message.tool_calls?.length) {
      return message.content ?? '';
    }
  }

  return '';
}

/** 向 AgentContext 注入角色列表提示词
 *
 * 当存在子代理工具时，将可用角色列表注入系统提示词，
 * 使 LLM 知道可以调用 runSubAgent 并传入哪些角色 ID。
 */
function injectRolesPrompt(
  ctx: AgentContext,
  tools: readonly Tool[],
  roleCatalog?: RoleCatalog
): void {
  if (!tools.some(tool => tool.name === SUBAGENT_TOOL_NAME_RUN)) {
    ctx.removePromptSection(ROLES_PROMPT_SECTION);
    return;
  }

  const roles = roleCatalog?.getRolesList() ?? [];
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

/** 从 providers 配置中解析模型定义 */
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

/** 根据 LLM 配置构建对应的 Provider 实例 */
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
    case LLMProviderType.OpenAIResponses:
    default:
      return new OpenAIResponsesProvider(providerConfig, [modelDef]);
  }
}

/** 创建钩子感知的 LLM 中间件
 *
 * 在 LLM 请求发送前触发 beforeLLMRequest 钩子，
 * 若钩子返回 block 则终止请求并抛出错误。
 */
function createHookAwareLLMMiddleware(
  stats: Pick<AesyiuRunStats, 'steps' | 'error'>,
  hookRuntime: PluginHookRuntime,
  hookTools: HookPayloadLLMTool[],
  hookSkills: HookPayloadLLMSkill[],
): LLMMiddleware {
  return async (ctx, next) => {
    stats.steps += 1;

    try {
      const beforeLLMResult = await hookRuntime.dispatchBeforeLLMRequest({
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

/** 创建钩子感知的工具中间件
 *
 * 在工具执行前后触发 beforeToolCall / afterToolCall 钩子，
 * 支持工具权限二次校验与短路执行。
 */
function createHookAwareToolMiddleware(
  toolIndex: Map<string, Tool>,
  stats: Pick<AesyiuRunStats, 'toolCalls'>,
  hookRuntime: PluginHookRuntime,
  options: {
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
        roleId: options.getRoleId(),
      },
      'Starting tool execution'
    );

    const beforeToolResult = await hookRuntime.dispatchBeforeToolCall({
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
        },
        'Tool execution short-circuited by hook'
      );
    } else {
      toolResult = await next() as ToolExecutionResult;
    }

    const finalResult = await hookRuntime.dispatchAfterToolCall({
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
        success: finalResult.success,
        content: truncateToolLogContent(finalResult.content),
        error: finalResult.error,
        metadata: finalResult.metadata,
      },
      'Tool execution completed'
    );

    return finalResult;
  };
}

/** 将内部 Tool 转换为 aesyiu 工具格式 */
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
  llmConfig: LLMConfig;
  providers: ProvidersConfig;
  maxContextTokens: number;
  compressionThreshold: number;
  maxSteps: number;
  filteredTools: Tool[];
  allowedSkills: AgentSkill[];
  messages: AesyiuMessage[];
  stats: AesyiuRunStats;
  hookRuntime: PluginHookRuntime;
  createToolContext: (_ctx: unknown, _tool: Tool) => ToolExecuteContext;
  checkToolAllowed?: (_tool: Tool) => ToolExecutionResult | null;
  getRoleId?: () => string;
  roleCatalog?: RoleCatalog;
}

/** 构建 aesyiu 引擎与上下文
 *
 * 将 AesyClaw 的工具、技能、配置转换为 aesyiu 格式，
 * 注册钩子感知的 LLM/Tool 中间件，注入角色列表提示词。
 */
export function buildAesyiuEngine(options: BuildAesyiuEngineOptions): {
  engine: AesyiuEngine;
  context: AgentContext;
} {
  const toolDefs = options.filteredTools.map(tool => tool.getDefinition());
  const hookSkills = buildHookSkills(options.allowedSkills);
  const hookTools = buildHookTools(toolDefs, options.allowedSkills);

  const modelDef = resolveModelDefinition(
    options.llmConfig.model || 'gpt-4o-mini',
    options.providers,
    options.maxContextTokens
  );
  const provider = buildProvider(options.llmConfig, modelDef);

  const context = new AgentContext({ provider, modelId: options.llmConfig.model });
  context.state.chatId = options.chatId;
  context.addMessages(options.messages);

  injectRolesPrompt(context, options.filteredTools, options.roleCatalog);

  const engine = new AesyiuEngine({
    maxSteps: options.maxSteps,
    compatibilityMode: true,
    memoryManager: new MemoryManager({
      compressThresholdRatio: options.compressionThreshold,
      retainLatestMessages: SESSION_MEMORY_RETAIN_LATEST_MESSAGES,
    }),
  });

  const toolIndex = new Map(options.filteredTools.map(tool => [tool.name, tool] as const));
  const getRoleId = options.getRoleId ?? (() => '');

  engine.useLLM(createHookAwareLLMMiddleware(options.stats, options.hookRuntime, hookTools, hookSkills));
  engine.useTool(createHookAwareToolMiddleware(toolIndex, options.stats, options.hookRuntime, {
    chatId: options.chatId,
    checkToolAllowed: options.checkToolAllowed,
    getRoleId,
  }));

  for (const tool of options.filteredTools) {
    engine.registerTool(toAesyiuTool(tool, options.createToolContext));
  }
  engine.registerSkills(options.allowedSkills);
  normalizeEngineToolParameters(engine);

  return { engine, context };
}

/** 手动压缩消息
 *
 * 强制触发 MemoryManager 的压缩逻辑，将历史消息压缩为摘要。
 * 用于 /compact 命令手动压缩会话。
 */
export async function manuallyCompactMessages(options: {
  chatId: string;
  llmConfig: LLMConfig;
  providers: ProvidersConfig;
  maxContextTokens: number;
  compressionThreshold: number;
  messages: StandardMessage[];
}): Promise<StandardMessage[]> {
  const modelDef = resolveModelDefinition(
    options.llmConfig.model || 'gpt-4o-mini',
    options.providers,
    options.maxContextTokens
  );
  const provider = buildProvider(options.llmConfig, modelDef);
  const context = new AgentContext({ provider, modelId: options.llmConfig.model });

  context.state.chatId = options.chatId;
  context.addMessages(options.messages.map(toAesyiuMessage));

  const memoryManager = new MemoryManager({
    compressThresholdRatio: options.compressionThreshold,
    retainLatestMessages: SESSION_MEMORY_RETAIN_LATEST_MESSAGES,
  });

  const forceCompressionUsage: TokenUsage = {
    promptTokens: modelDef.contextWindow + 1,
    completionTokens: 0,
    totalTokens: modelDef.contextWindow + 1,
  };

  await memoryManager.checkAndOptimize(context, forceCompressionUsage);
  return context.getVisibleMessages().map(toStandardMessage);
}
