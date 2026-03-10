import type { LLMProvider } from '../../providers/base.js';
import type { MemoryFactsConfig, MemorySummaryConfig } from '../../types.js';
import type { Session, SessionManager, SessionMessage, MemoryFact } from '../../session/SessionManager.js';
import { logger } from '../../logger/index.js';

interface MemorySummaryRuntimeConfig {
  enabled: boolean;
  model?: string;
  triggerMessages: number;
  memoryWindow: number;
}

interface MemoryFactsRuntimeConfig {
  enabled: boolean;
  model?: string;
  maxFacts: number;
}

export class SessionMemoryService {
  private log = logger.child({ prefix: 'SessionMemory' });

  constructor(
    private sessionManager: SessionManager,
    private summaryProvider: LLMProvider | undefined,
    private summaryConfig: MemorySummaryRuntimeConfig,
    private factsProvider?: LLMProvider,
    private factsConfig?: MemoryFactsRuntimeConfig
  ) {}

  static createRuntimeConfig(config: MemorySummaryConfig | undefined, memoryWindow: number, model?: string): MemorySummaryRuntimeConfig {
    return {
      enabled: config?.enabled === true,
      model,
      triggerMessages: config?.triggerMessages ?? 20,
      memoryWindow
    };
  }

  static createFactsRuntimeConfig(config: MemoryFactsConfig | undefined, model?: string): MemoryFactsRuntimeConfig {
    return {
      enabled: config?.enabled === true,
      model,
      maxFacts: config?.maxFacts ?? 20
    };
  }

  async buildHistory(session: Session): Promise<SessionMessage[]> {
    const facts = await this.sessionManager.getFacts(session.channel, session.chatId);
    const factMessage = this.buildFactsMessage(facts);
    const summaryMessage = session.summary.trim()
      ? [{
          role: 'system' as const,
          content: `以下是当前会话的历史摘要，请把它当作长期上下文参考，而不是用户当前最新输入：\n${session.summary.trim()}`
        }]
      : [];

    const recentStart = Math.max(
      session.summarizedMessageCount,
      session.messages.length - this.summaryConfig.memoryWindow,
      0
    );

    return [...factMessage, ...summaryMessage, ...session.messages.slice(recentStart)];
  }

  async maybeSummarizeSession(sessionKey: string): Promise<boolean> {
    if (!this.summaryConfig.enabled || !this.summaryProvider) {
      return false;
    }

    const session = await this.sessionManager.getOrCreate(sessionKey);
    const summaryCutoff = Math.max(0, session.messages.length - this.summaryConfig.memoryWindow);
    const pendingMessages = session.messages.slice(session.summarizedMessageCount, summaryCutoff);

    if (pendingMessages.length < this.summaryConfig.triggerMessages) {
      return false;
    }

    try {
      const summary = await this.generateSummary(session.summary, pendingMessages);
      if (!summary) {
        return false;
      }

      await this.sessionManager.updateSummary(sessionKey, summary, summaryCutoff);
      this.log.info(`Updated summary for session ${sessionKey}, summarized messages: ${summaryCutoff}`);
      return true;
    } catch (error) {
      this.log.warn(`Failed to summarize session ${sessionKey}:`, error);
      return false;
    }
  }

  updateConfig(summaryProvider: LLMProvider | undefined, config: MemorySummaryRuntimeConfig): void {
    this.summaryProvider = summaryProvider;
    this.summaryConfig = config;
  }

  updateFactsConfig(factsProvider: LLMProvider | undefined, config: MemoryFactsRuntimeConfig): void {
    this.factsProvider = factsProvider;
    this.factsConfig = config;
  }

  async maybePersistMemory(sessionKey: string, userContent: string, assistantContent: string): Promise<void> {
    await this.maybeExtractFacts(sessionKey, userContent, assistantContent);
    await this.maybeSummarizeSession(sessionKey);
  }

  private async generateSummary(existingSummary: string, messages: SessionMessage[]): Promise<string | null> {
    const transcript = messages
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n\n');

    const response = await this.summaryProvider!.chat([
      {
        role: 'system',
        content: [
          '你是一个对话记忆压缩器。',
          '请把会话中值得长期保留的信息整理成紧凑摘要。',
          '重点保留：用户偏好、身份背景、长期目标、当前任务、已确认事实、未完成事项。',
          '忽略寒暄、重复表达、低价值废话。',
          '输出纯文本，不要使用代码块，不要编造信息。'
        ].join('')
      },
      {
        role: 'user',
        content: [
          existingSummary ? `已有摘要：\n${existingSummary}\n` : '已有摘要：\n(无)\n',
          '请基于已有摘要和下面新增对话，生成新的完整摘要。\n',
          '新增对话：\n',
          transcript
        ].join('\n')
      }
    ], undefined, this.summaryConfig.model, { reasoning: false });

    return response.content?.trim() || null;
  }

  private buildFactsMessage(facts: MemoryFact[]): SessionMessage[] {
    if (facts.length === 0) {
      return [];
    }

    return [{
      role: 'system',
      content: [
        '以下是从历史对话中提炼出的长期记忆事实，只在相关时参考，不要当作本轮用户新输入：',
        ...facts.map((fact, index) => `${index + 1}. ${fact.content}`)
      ].join('\n')
    }];
  }

  private async maybeExtractFacts(sessionKey: string, userContent: string, assistantContent: string): Promise<void> {
    if (!this.factsConfig?.enabled || !this.factsProvider) {
      return;
    }

    const session = await this.sessionManager.getOrCreate(sessionKey);
    const existingFacts = await this.sessionManager.getFacts(session.channel, session.chatId);
    const extractedFacts = await this.extractFacts(existingFacts, userContent, assistantContent);

    if (extractedFacts.length === 0) {
      return;
    }

    const mergedFacts = Array.from(new Set([
      ...extractedFacts,
      ...existingFacts.map((fact) => fact.content)
    ])).slice(0, this.factsConfig.maxFacts);

    await this.sessionManager.setFacts(session.channel, session.chatId, mergedFacts);
    this.log.info(`Updated facts for ${session.channel}:${session.chatId}, total facts: ${mergedFacts.length}`);
  }

  private async extractFacts(existingFacts: MemoryFact[], userContent: string, assistantContent: string): Promise<string[]> {
    const existingFactsBlock = existingFacts.length > 0
      ? existingFacts.map((fact, index) => `${index + 1}. ${fact.content}`).join('\n')
      : '(无)';

    const response = await this.factsProvider!.chat([
      {
        role: 'system',
        content: [
          '你是一个长期记忆提取器。',
          '请只提取适合长期保留的稳定事实。',
          '只保留：用户偏好、身份背景、长期目标、项目背景、明确约束。',
          '不要提取临时寒暄、单次闲聊、推测内容。',
          '如果没有值得记住的内容，输出“无”。',
          '输出格式：每行一条事实，不要编号，不要解释。'
        ].join('')
      },
      {
        role: 'user',
        content: [
          `已有长期记忆：\n${existingFactsBlock}`,
          `用户刚刚说：\n${userContent || '(空)'}`,
          `助手刚刚回复：\n${assistantContent || '(空)'}`,
          '请提取新增的长期记忆事实。'
        ].join('\n\n')
      }
    ], undefined, this.factsConfig?.model, { reasoning: false });

    const raw = response.content?.trim() || '';
    if (!raw || raw === '无') {
      return [];
    }

    return raw
      .split('\n')
      .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
      .filter((line) => line.length > 0 && line !== '无');
  }
}
