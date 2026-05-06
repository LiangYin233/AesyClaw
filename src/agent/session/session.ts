import type { SessionKey, PersistableMessage } from '@aesyclaw/core/types';
import type { AgentMessage } from '../agent-types';
import {
  assistantHasToolCalls,
  createPersistedAssistantMessage,
  createUserMessage,
  extractMessageText,
  makeExtraBodyOnPayload,
} from '../agent-types';
import type { LlmAdapter } from '../llm-adapter';
import type { ResolvedModel } from '../agent-types';
import type {
  MessagesRepository,
  UsageRepository,
  ToolUsageRepository,
} from '@aesyclaw/core/database/database-manager';
import { completeSimple } from '@mariozechner/pi-ai';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('session');

export class Session {
  readonly sessionId: string;
  readonly key: SessionKey;
  private _messages: AgentMessage[] = [];
  private _locked = false;
  private _activeRoleId?: string;
  modelOverride?: string;

  constructor(
    sessionId: string,
    key: SessionKey,
    private db: {
      messages: MessagesRepository;
      usage?: UsageRepository;
      toolUsage?: ToolUsageRepository;
    },
  ) {
    this.sessionId = sessionId;
    this.key = key;
  }

  get isLocked(): boolean {
    return this._locked;
  }

  get activeRoleId(): string | undefined {
    return this._activeRoleId;
  }

  setActiveRoleId(roleId: string): void {
    this._activeRoleId = roleId;
  }

  lock(): boolean {
    if (this._locked) return false;
    this._locked = true;
    return true;
  }

  unlock(): void {
    this._locked = false;
  }

  get(): readonly AgentMessage[] {
    return this._messages;
  }

  async bind(): Promise<void> {
    const records = await this.db.messages.loadHistory(this.sessionId);
    this._messages = records.map((r) =>
      r.role === 'user'
        ? createUserMessage(r.content, parseTimestamp(r.timestamp))
        : createPersistedAssistantMessage(r.content, parseTimestamp(r.timestamp)),
    );
  }

  async add(message: AgentMessage): Promise<void> {
    await this.recordUsageIfApplicable(message);
    this._messages.push(message);

    const persistable = toPersistable(message);
    if (!persistable) return;

    await this.db.messages.save(this.sessionId, persistable);
  }

  async syncFromAgent(agentMessages: AgentMessage[]): Promise<void> {
    sanitizeGhostToolCalls(agentMessages);

    for (const msg of agentMessages) {
      await this.add(msg);
    }

    await this.recordToolCallsFromMessages(agentMessages);
  }

  async clear(): Promise<void> {
    this._messages = [];
    await this.db.messages.clearHistory(this.sessionId);
    logger.info('会话历史已清除', { sessionId: this.sessionId });
  }

  async compact(llmAdapter: LlmAdapter, modelIdentifier: string): Promise<string> {
    if (this._messages.length <= 2) {
      logger.info('会话历史太短，无需压缩', {
        sessionId: this.sessionId,
        messageCount: this._messages.length,
      });
      return '会话历史太短，无需压缩。';
    }

    logger.info('正在压缩会话历史', {
      sessionId: this.sessionId,
      messageCount: this._messages.length,
    });

    const model = llmAdapter.resolveModel(modelIdentifier);
    const summary = await this.summarizeConversation(model, this._messages);
    await this.db.messages.replaceWithSummary(this.sessionId, summary);
    await this.bind();

    logger.info('会话历史已压缩', {
      sessionId: this.sessionId,
      summaryLength: summary.length,
    });

    return summary;
  }

  filter(pred: (msg: AgentMessage) => boolean): AgentMessage[] {
    return this._messages.filter(pred);
  }

  private async recordUsageIfApplicable(message: AgentMessage): Promise<void> {
    if (
      this.db.usage === undefined ||
      message.role !== 'assistant' ||
      message.usage === undefined ||
      message.usage.totalTokens <= 0
    )
      return;

    try {
      await this.db.usage.create({
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

  private async recordToolCallsFromMessages(agentMessages: AgentMessage[]): Promise<void> {
    if (!this.db.toolUsage) return;

    for (const message of agentMessages) {
      if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;

      for (const block of message.content) {
        if (typeof block !== 'object' || !('type' in block)) continue;
        if (block.type !== 'toolCall') continue;

        const toolCall = block as { name: string; arguments?: Record<string, unknown> };
        try {
          await this.db.toolUsage.create({ name: toolCall.name, type: 'tool' });
        } catch (err) {
          logger.error('记录工具调用失败', err);
        }

        const skillName = toolCall.arguments?.['skillName'];
        if (toolCall.name === 'load_skill' && typeof skillName === 'string') {
          try {
            await this.db.toolUsage.create({ name: String(skillName), type: 'skill' });
          } catch (err) {
            logger.error('记录技能加载调用失败', err);
          }
        }
      }
    }
  }

  private async summarizeConversation(
    model: ResolvedModel,
    messages: AgentMessage[],
  ): Promise<string> {
    const prompt = buildSummaryPrompt(messages);

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
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      {
        apiKey: model.apiKey,
        sessionId: this.sessionId,
        onPayload: makeExtraBodyOnPayload(model),
      },
    );

    const summary = extractMessageText(response).trim();
    if (summary.length === 0) throw new Error('LLM 返回了空总结');
    return summary;
  }
}

function sanitizeGhostToolCalls(agentMessages: AgentMessage[]): void {
  for (const message of agentMessages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;

    const filtered = (message.content as Array<{ type?: string; name?: string }>).filter(
      (block) => {
        if (block.type !== 'toolCall') return true;
        if (block.name) return true;
        logger.warn('清理幽灵 ToolCall 块', { blockId: (block as Record<string, unknown>)['id'] });
        return false;
      },
    );

    if (filtered.length < message.content.length) {
      (message as unknown as Record<string, unknown>)['content'] = filtered;
    }
  }
}

function toPersistable(message: AgentMessage): PersistableMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  if (message.role === 'assistant' && assistantHasToolCalls(message)) return null;

  const text = extractMessageText(message).trim();
  if (text.length === 0) return null;

  return { role: message.role, content: text, timestamp: new Date().toISOString() };
}

function parseTimestamp(timestamp?: string): number {
  if (!timestamp) return Date.now();
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function buildSummaryPrompt(messages: AgentMessage[]): string {
  const transcript = messages
    .map((m) => `${m.role.toUpperCase()}: ${extractMessageText(m).trim()}`)
    .filter((line) => !line.endsWith(':'))
    .join('\n\n');
  return ['Conversation transcript:', '', transcript].join('\n');
}
