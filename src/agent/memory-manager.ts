/**
 * MemoryManager — 管理会话的对话历史。
 *
 * 职责：
 * - 从数据库加载持久化的消息并转换为 AgentMessage 格式
 * - 使用过滤策略持久化 Agent 状态中的消息 (§5.7.3)
 * - 当历史过长时通过 LLM 总结进行压缩
 * - 清除会话历史
 *
 * 过滤策略：
 * - `role === 'user'` → 始终保存
 * - `role === 'assistant'` 无 toolCalls → 保存
 * - `role === 'assistant'` 有 toolCalls → 跳过（内部推理，对用户不可见）
 * - `role === 'toolResult'` → 跳过（内部结果）
 * - 空内容 → 跳过
 *
 */

import type { PersistableMessage } from '@aesyclaw/core/types';
import {
  assistantHasToolCalls,
  createPersistedAssistantMessage,
  createUserMessage,
  extractMessageText,
  makeExtraBodyOnPayload,
} from './agent-types';
import type { AgentMessage, MemoryConfig, ResolvedModel } from './agent-types';
import type { LlmAdapter } from './llm-adapter';
import { completeSimple } from '@mariozechner/pi-ai';
import type {
  MessagesRepository,
  ToolUsageRepository,
  UsageRepository,
} from '@aesyclaw/core/database/database-manager';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('memory-manager');

// ─── MemoryManager ──────────────────────────────────────────────

export class MemoryManager {
  private readonly sessionId: string;
  private readonly messageRepo: MessagesRepository;
  private readonly usageRepo: UsageRepository | undefined;
  private readonly toolUsageRepo: ToolUsageRepository | undefined;
  private readonly config: MemoryConfig;

  constructor(
    sessionId: string,
    messageRepo: MessagesRepository,
    config: MemoryConfig,
    usageRepo?: UsageRepository,
    toolUsageRepo?: ToolUsageRepository,
  ) {
    this.sessionId = sessionId;
    this.messageRepo = messageRepo;
    this.usageRepo = usageRepo;
    this.toolUsageRepo = toolUsageRepo;
    this.config = config;
  }

  // ─── 读取 ──────────────────────────────────────────────────────

  /**
   * 从数据库加载对话历史并转换为 AgentMessage 格式。
   *
   * 将 PersistableMessage 记录（仅包含 role + content）
   * 转换为适合 Agent 的 AgentMessage 对象。
   *
   * @returns 表示该会话历史的 AgentMessage 数组
   */
  async loadHistory(): Promise<AgentMessage[]> {
    const records = await this.messageRepo.loadHistory(this.sessionId);

    return records.map((record) =>
      record.role === 'user'
        ? createUserMessage(record.content, this.parseTimestamp(record.timestamp))
        : createPersistedAssistantMessage(record.content, this.parseTimestamp(record.timestamp)),
    );
  }

  /**
   * 判断持久化的历史是否在下一轮模型调用前大到需要压缩。
   * 使用保守的文本估算，因为运行时目前不提供提供者特定的 token 计数。
   */
  shouldCompact(messages: AgentMessage[]): boolean {
    const threshold = this.config.maxContextTokens * this.config.compressionThreshold;
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return false;
    }

    return this.estimateTokens(messages) >= threshold;
  }

  // ─── 写入 ────────────────────────────────────────────────────

  /**
   * 将单个 AgentMessage 持久化到数据库，应用过滤策略。
   *
   * 过滤规则 (§5.7.3)：
   * - 跳过包含 toolCalls 的助手消息（内部推理）
   * - 跳过 toolResult 消息（内部结果）
   * - 跳过空内容消息
   * - 始终保存用户消息
   * - 保存纯文本的助手消息（无 toolCalls）
   *
   * @param message - 可能要持久化的 AgentMessage
   */
  async persistMessage(message: AgentMessage): Promise<boolean> {
    await this.recordUsageIfApplicable(message);

    const persistable = this.toPersistableMessage(message);
    if (!persistable) {
      return false;
    }

    await this.messageRepo.save(this.sessionId, persistable);
    return true;
  }

  /**
   * 将 Agent 状态中的所有消息同步到数据库。
   *
   * 遍历 Agent 消息并通过 persistMessage 应用过滤策略。
   *
   * @param agentMessages - Agent 状态中的当前消息
   */
  async syncFromAgent(agentMessages: AgentMessage[]): Promise<void> {
    this.sanitizeGhostToolCalls(agentMessages);

    let persisted = 0;
    let filtered = 0;

    for (const message of agentMessages) {
      const didPersist = await this.persistMessage(message);
      if (didPersist) {
        persisted++;
      } else {
        filtered++;
      }
    }

    await this.recordToolCallsFromMessages(agentMessages);

    logger.debug(
      `已同步 ${agentMessages.length} 条消息：${persisted} 条已持久化，${filtered} 条已过滤`,
    );
  }

  // ─── 压缩 ──────────────────────────────────────────────────

  /**
   * 通过 LLM 总结来压缩会话的对话历史。
   *
   * 流程：
   * 1. 从数据库加载当前历史
   * 2. 如果消息太少（≤ 2），跳过 — 太短无法压缩
   * 3. 调用 summarizeConversation 生成总结
   * 4. 在数据库中替换会话的消息为总结
   * 5. 返回总结
   *
   * @param llmAdapter - 用于总结的 LLM 适配器
   * @param modelIdentifier - 复用于总结的角色模型
   * @returns 生成的总结，或如果太短则返回跳过消息
   */
  async compact(llmAdapter: LlmAdapter, modelIdentifier: string): Promise<string> {
    const messages = await this.loadHistory();

    if (messages.length <= 2) {
      logger.info('会话历史太短，无需压缩', {
        sessionId: this.sessionId,
        messageCount: messages.length,
      });
      return '会话历史太短，无需压缩。';
    }

    logger.info('正在压缩会话历史', {
      sessionId: this.sessionId,
      messageCount: messages.length,
    });

    const model = llmAdapter.resolveModel(modelIdentifier);
    const summary = await this.summarizeConversation(model, messages);

    await this.messageRepo.replaceWithSummary(this.sessionId, summary);

    logger.info('会话历史已压缩', {
      sessionId: this.sessionId,
      originalMessages: messages.length,
      summaryLength: summary.length,
    });

    return summary;
  }

  // ─── 清除 ────────────────────────────────────────────────────

  /**
   * 清除数据库中的所有会话历史。
   */
  async clear(): Promise<void> {
    await this.messageRepo.clearHistory(this.sessionId);
    logger.info('会话历史已清除', { sessionId: this.sessionId });
  }

  // ─── 私有辅助方法 ───────────────────────────────────────────

  private async recordUsageIfApplicable(message: AgentMessage): Promise<void> {
    if (
      this.usageRepo === undefined ||
      message.role !== 'assistant' ||
      message.usage === undefined ||
      message.usage.totalTokens <= 0
    ) {
      return;
    }

    try {
      await this.usageRepo.create({
        model: message.model,
        provider: message.provider,
        api: message.api,
        responseId: message.responseId,
        usage: message.usage,
      });
    } catch (err) {
      logger.error('记录用量失败', err);
    }
  }

  /**
   * 清理 provider 流式事件产生的幽灵 ToolCall 块（name/id 均为空）。
   * 这些块是 pi-agent 在 streaming toolcall_start 事件缺少 toolName 时产生的。
   */
  private sanitizeGhostToolCalls(agentMessages: AgentMessage[]): void {
    for (const message of agentMessages) {
      if (message.role !== 'assistant' || !Array.isArray(message.content)) {
        continue;
      }

      const filtered = (message.content as Array<{ type?: string; name?: string }>).filter(
        (block) => {
          if (block.type !== 'toolCall') return true;
          if (block.name) return true;
          logger.warn('清理幽灵 ToolCall 块（provider 流式事件缺少 toolName）', {
            blockId: (block as Record<string, unknown>)['id'],
          });
          return false;
        },
      );

      if (filtered.length < message.content.length) {
        (message as unknown as Record<string, unknown>)['content'] = filtered;
      }
    }
  }

  private async recordToolCallsFromMessages(agentMessages: AgentMessage[]): Promise<void> {
    if (!this.toolUsageRepo) return;

    for (const message of agentMessages) {
      if (message.role !== 'assistant' || !Array.isArray(message.content)) {
        continue;
      }

      for (const block of message.content) {
        if (typeof block !== 'object' || !('type' in block)) {
          continue;
        }

        if (block.type === 'toolCall') {
          const toolCall = block as { name: string; arguments?: Record<string, unknown> };

          try {
            await this.toolUsageRepo.create({ name: toolCall.name, type: 'tool' });
          } catch (err) {
            logger.error('记录工具调用失败', err);
          }

          // load_skill 工具额外记录技能加载
          const skillName = toolCall.arguments?.['skillName'];
          if (toolCall.name === 'load_skill' && typeof skillName === 'string') {
            try {
              await this.toolUsageRepo.create({
                name: String(skillName),
                type: 'skill',
              });
            } catch (err) {
              logger.error('记录技能加载调用失败', err);
            }
          }
        }
      }
    }
  }

  private toPersistableMessage(message: AgentMessage): PersistableMessage | null {
    if (message.role !== 'user' && message.role !== 'assistant') {
      return null;
    }

    if (message.role === 'assistant' && assistantHasToolCalls(message)) {
      return null;
    }

    const text = extractMessageText(message).trim();
    if (text.length === 0) {
      return null;
    }

    return {
      role: message.role,
      content: text,
      timestamp: new Date().toISOString(),
    };
  }

  private parseTimestamp(timestamp?: string): number {
    if (!timestamp) {
      return Date.now();
    }

    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }

  private estimateTokens(messages: AgentMessage[]): number {
    const textLength = messages.reduce(
      (total, message) => total + extractMessageText(message).length,
      0,
    );
    return Math.ceil(textLength / 4);
  }

  private async summarizeConversation(
    model: ResolvedModel,
    messages: AgentMessage[],
  ): Promise<string> {
    const prompt = this.buildSummaryPrompt(messages);

    const response = await completeSimple(
      model,
      {
        systemPrompt: [
          'You are a conversation archivist. Summarize the following dialogue into a compact record for future turns.',
          'Output ONLY the summary in the following structure, using plain text:',
          '',
          '## Previous Discussion',
          '- What has already been discussed with the user (topics, decisions made, conclusions reached)',
          '',
          '## Current Focus',
          '- What is being worked on or discussed right now (the active task or question)',
          '',
          '## Next Steps',
          '- What remains to be done, unresolved questions, or pending follow-ups',
          '',
          '## Notes',
          '- Special constraints, important facts, user preferences, tool results, file paths, or any context critical for continuity',
          '',
          'Keep each section concise. Do not mention that you are summarizing or refer to missing context.',
        ].join('\n'),
        messages: [
          {
            role: 'user',
            content: prompt,
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: model.apiKey,
        sessionId: this.sessionId,
        onPayload: makeExtraBodyOnPayload(model),
      },
    );

    const summary = extractMessageText(response).trim();
    if (summary.length === 0) {
      throw new Error('LLM 返回了空总结');
    }

    return summary;
  }

  private buildSummaryPrompt(messages: AgentMessage[]): string {
    const transcript = messages
      .map((message) => `${message.role.toUpperCase()}: ${extractMessageText(message).trim()}`)
      .filter((line) => !line.endsWith(':'))
      .join('\n\n');

    return ['Conversation transcript:', '', transcript].join('\n');
  }
}
