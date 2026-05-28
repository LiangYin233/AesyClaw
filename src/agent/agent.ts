import {
  getMessageText,
  type CommandContext,
  type Message,
  type RoleConfig,
  type SessionKey,
  type OutboundSignal,
} from '@aesyclaw/core/types';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { AgentMessage, ResolvedModel } from './types';
import { createUserMessage } from '@aesyclaw/contracts/llm';
import type {
  AesyClawTool,
  ToolExecutionContext,
  ToolRegistry,
} from '@aesyclaw/tool/tool-registry';
import type { LlmAdapter } from './llm/adapter';
import { estimateApproximateTokens, type Session } from '@aesyclaw/session';
import type { RoleManager } from '@aesyclaw/role/manager';
import type { SkillManager } from '@aesyclaw/skill/manager';
import type { IHooksBus } from '@aesyclaw/hook';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { AgentRegistry } from './registry';
import { runAgentTask, type AgentRunResult } from './runner';
import { buildPrompt as buildPromptFromBuilder, type BuildPromptResult } from './prompt/builder';

const logger = createScopedLogger('agent');

/**
 * Agent 构造选项。
 */
export type AgentOptions = {
  session: Session;
  llmAdapter: LlmAdapter;
  roleManager: RoleManager;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  hooksBus: IHooksBus;
  compressionThreshold: number;
  registry: AgentRegistry;
};

type ProcessOptions = {
  ephemeral?: boolean;
  role?: RoleConfig;
};

type ProcessContext = {
  role: RoleConfig;
  effectiveRole: RoleConfig;
  ephemeral: boolean;
};

/**
 * Agent 核心类，承担消息处理、LLM 调用和 Prompt 构建的职责。
 */
export class Agent {
  readonly session: Session;
  roleId?: string;

  private compressionThreshold: number;

  private _model!: ResolvedModel;
  private _activeRole: RoleConfig | null = null;
  private _allowedTools: AesyClawTool[] = [];

  private llmAdapter: LlmAdapter;
  private roleManager: RoleManager;
  private skillManager: SkillManager;
  private toolRegistry: ToolRegistry;
  private hooksBus: IHooksBus;
  private registry: AgentRegistry;

  private _cachedSystemPrompt: string | null = null;

  static async resolveActiveRoleId(
    context: CommandContext,
    deps: {
      databaseManager: Pick<DatabaseManager, 'roleBindings' | 'sessions'>;
      agentRegistry: AgentRegistry;
    },
  ): Promise<string | undefined> {
    const agent = deps.agentRegistry.getAgent(context.sessionKey);
    if (agent?.roleId) return agent.roleId;

    const session = await deps.databaseManager.sessions.findByKey(context.sessionKey);
    if (!session) return undefined;

    return (await deps.databaseManager.roleBindings.getActiveRole(session.id)) ?? undefined;
  }

  /**
   * @param options - Agent 构造选项
   */
  constructor(options: AgentOptions) {
    this.session = options.session;
    this.llmAdapter = options.llmAdapter;
    this.roleManager = options.roleManager;
    this.skillManager = options.skillManager;
    this.toolRegistry = options.toolRegistry;
    this.hooksBus = options.hooksBus;
    this.compressionThreshold = options.compressionThreshold;
    this.registry = options.registry;

    this.registry.registerAgent(this.session.key, this);
  }

  /** 当前解析后的模型配置 */
  get model(): ResolvedModel {
    return this._model;
  }

  /** 当前角色允许使用的工具列表 */
  get allowedTools(): AesyClawTool[] {
    return this._allowedTools;
  }

  /** 当前激活的角色配置 */
  get activeRole(): RoleConfig | null {
    return this._activeRole;
  }

  /**
   * 设置当前使用的模型。
   *
   * @param modelId - 模型标识符，例如 "openai/gpt-4o"
   */
  setModel(modelId: string): void {
    this._model = this.llmAdapter.resolveModel(modelId);
    logger.info('模型已切换', {
      provider: this._model.provider,
      modelId: this._model.modelId,
    });
  }

  async setRole(role: RoleConfig): Promise<void> {
    this._activeRole = role;

    this._allowedTools = this.toolRegistry.getForRole(role);

    this._model = this.llmAdapter.resolveModel(role.model);

    this.roleId = role.id;
    this._cachedSystemPrompt = null;
  }

  /**
   * 使缓存的系统 Prompt 失效，强制下次 LLM 调用时重新构建。
   *
   * 在技能重新加载后调用，确保 Prompt 包含最新的技能列表。
   */
  invalidatePromptCache(): void {
    this._cachedSystemPrompt = null;
    logger.debug('Prompt 缓存已失效');
  }

  /**
   * 处理用户消息，调用 LLM 并返回回复。
   *
   * @param message - 用户消息
   * @param sendMessage - 可选的发消息回调
   * @param options - 可选配置（ephemeral 标记、临时角色）
   * @param onStream - 流式事件回调，每收到一个中间事件则调用一次
   * @returns Agent 回复消息
   */
  async process(
    message: Message,
    sendMessage?: (message: Message) => Promise<boolean>,
    options?: ProcessOptions,
    onStream?: (event: OutboundSignal) => void,
  ): Promise<Message> {
    const context = this.createProcessContext(options);
    if (!context) {
      return { components: [{ type: 'Plain', text: '[错误: 无可用角色]' }] };
    }
    const { role, effectiveRole, ephemeral } = context;

    const content = getMessageText(message);

    logger.debug('正在处理消息', {
      sessionKey: this.session.key,
      role: role.id,
      contentLength: content.length,
      ephemeral,
    });

    const history = await this.loadHistory(role, ephemeral);

    let messageSent = false;
    const trackedSendMessage =
      !ephemeral && sendMessage
        ? async (msg: Message): Promise<boolean> => {
            messageSent = true;
            return await sendMessage(msg);
          }
        : undefined;

    const result = await this.callLLM(
      effectiveRole,
      content,
      history,
      this.session.key,
      trackedSendMessage,
      onStream,
    );

    const finalResult = await this.handleResult(
      context,
      history,
      result,
      messageSent,
      sendMessage,
      content,
    );

    return this.toMessage(effectiveRole.id, finalResult);
  }

  /**
   * 处理 LLM 调用结果：决定是否追文本、持久化到会话。
   */
  private async handleResult(
    context: ProcessContext,
    history: AgentMessage[],
    result: AgentRunResult,
    messageSent: boolean,
    sendMessage: ((message: Message) => Promise<boolean>) | undefined,
    content: string,
  ): Promise<AgentRunResult> {
    const finalResult = this.needsTextFollowUp(context, result, messageSent)
      ? await this.ensureAssistantText(context.effectiveRole, history, result, sendMessage)
      : result;

    if (!context.ephemeral) {
      await this.session.syncFromAgent(finalResult.newMessages);
      // 若 Agent 被 /stop 中止，用户的输入消息只存在于 PiAgent
      // 内部状态中（被丢弃了），没有通过 syncFromAgent 持久化。
      // 这里单独将其追加到会话，确保后续消息能看见前文。
      if (finalResult.cancelled) {
        await this.session.add(createUserMessage(content));
      }
    }

    return finalResult;
  }

  /**
   * 判断是否需要后续追文 — 条件为：非临时、未取消、未通过流式产生文本、LLM 未返回文字。
   */
  private needsTextFollowUp(
    context: ProcessContext,
    result: AgentRunResult,
    messageSent: boolean,
  ): boolean {
    if (context.ephemeral) return false;
    if (result.cancelled) return false;
    if (messageSent && !result.lastAssistant) return false;
    return !result.lastAssistant;
  }

  /**
   * 调用 LLM，异步执行提示循环。
   *
   * @param role - 角色配置
   * @param content - 用户输入文本
   * @param history - 历史消息
   * @param sessionKey - 会话标识
   * @param sendMessage - 可选的发消息回调
   * @returns LLM 调用结果
   */
  async callLLM(
    role: RoleConfig,
    content: string,
    history: AgentMessage[],
    sessionKey: SessionKey,
    sendMessage?: (message: Message) => Promise<boolean>,
    onStream?: (event: OutboundSignal) => void,
  ): Promise<AgentRunResult> {
    const executionContext: Partial<ToolExecutionContext> = {
      sessionKey,
      sendMessage,
      toolPermission: role.toolPermission,
    };

    const { prompt: builtPrompt, tools } = this.buildPrompt(role, executionContext);
    const prompt = this._cachedSystemPrompt ?? builtPrompt;
    this._cachedSystemPrompt ??= builtPrompt;
    const model = this.llmAdapter.resolveModel(role.model);

    return await runAgentTask({
      roleId: role.id,
      model,
      prompt,
      tools,
      history,
      content,
      sessionKey,
      compressionThreshold: this.compressionThreshold,
      registry: this.registry,
      onEvent: onStream,
    });
  }

  /**
   * 构建发送给 LLM 的完整 Prompt。
   * 委托给 prompt-builder 模块。
   */
  buildPrompt(
    role: RoleConfig,
    executionContext?: Partial<ToolExecutionContext>,
  ): BuildPromptResult {
    return buildPromptFromBuilder(role, executionContext, {
      roleManager: this.roleManager,
      skillManager: this.skillManager,
      toolRegistry: this.toolRegistry,
      hooksBus: this.hooksBus,
    });
  }

  private createProcessContext(options?: ProcessOptions): ProcessContext | null {
    const ephemeral = options?.ephemeral === true;
    const role = ephemeral ? options?.role : this._activeRole;
    if (!role) return null;

    return {
      role,
      effectiveRole: ephemeral
        ? { ...role, toolPermission: { mode: 'allowlist' as const, list: [] } }
        : role,
      ephemeral,
    };
  }

  private async loadHistory(_role: RoleConfig, _ephemeral: boolean): Promise<AgentMessage[]> {
    return this.session.get() as AgentMessage[];
  }

  private async ensureAssistantText(
    role: RoleConfig,
    history: AgentMessage[],
    result: AgentRunResult,
    sendMessage?: (message: Message) => Promise<boolean>,
  ): Promise<AgentRunResult> {
    if (result.lastAssistant) return result;

    const combinedHistory = history.concat(result.newMessages);
    let followUpHistory = combinedHistory;

    if (
      estimateApproximateTokens(combinedHistory) >=
      this.compressionThreshold * this._model.contextWindow
    ) {
      logger.info('Agent 追加文本前压缩上下文', {
        role: role.id,
        estimatedTokens: estimateApproximateTokens(combinedHistory),
        contextWindow: this._model.contextWindow,
      });
      await this.session.compact(this.llmAdapter, role.model);
      followUpHistory = [...this.session.get()].concat(result.newMessages);
    }

    logger.info('Agent 未产出文本回复，追加提示要求必须生成文本', { role: role.id });
    const followUpResult = await this.callLLM(
      role,
      'You must generate a text response. If you already called tools, summarize their results. Do not call tools again unless absolutely necessary.',
      followUpHistory,
      this.session.key,
      sendMessage,
    );
    const followUpAssistantMessages = followUpResult.newMessages.filter((m) => m.role !== 'user');

    return {
      newMessages: result.newMessages.concat(followUpAssistantMessages),
      lastAssistant: followUpResult.lastAssistant,
      cancelled: followUpResult.cancelled,
    };
  }

  /**
   * 将 LLM 调用结果转换为用户可见的 Message。
   *
   * @param roleId - 角色标识
   * @param result - LLM 调用结果
   * @returns 包含文本组件的 Message
   */
  private toMessage(roleId: string, result: AgentRunResult): Message {
    if (result.lastAssistant) {
      return { components: [{ type: 'Plain', text: result.lastAssistant }] };
    }
    logger.warn('Agent 未生成助手文本回复', { role: roleId });
    return { components: [{ type: 'Plain', text: '[未生成回复]' }] };
  }
}
