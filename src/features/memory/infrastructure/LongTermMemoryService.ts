import { createHash } from 'crypto';
import type { InboundMessage } from '../../../types.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import type { SessionManager } from '../../../platform/context/SessionContext.js';
import {
  LongTermMemoryStore,
  type LongTermMemoryEntry,
  type LongTermMemoryEntryWithEmbedding,
  type LongTermMemoryOperation,
  type MemoryEntryKind,
  type MemoryOperationActor,
  type MemoryOperationInput,
  type MemoryOperationResult
} from './LongTermMemoryStore.js';
import { logger } from '../../../platform/observability/index.js';
import { OpenAIEmbeddingsClient } from './OpenAIEmbeddingsClient.js';

const MAX_BACKGROUND_ACTIONS = 5;

const MEMORY_MANAGER_SYSTEM_PROMPT = [
  '角色: 长期记忆管理器',
  '任务: 根据当前聊天对象的最新交互，决定是否需要创建、更新、合并、归档或删除长期记忆。',
  '长期记忆范围: 用户画像与偏好、长期项目背景、持续有效的规则/约定/限制、对当前聊天对象长期有帮助的上下文。',
  '禁止写入: 一次性任务、临时状态、不会长期复用的问答细节、推测内容。',
  '输出必须是 JSON 对象，格式为 {"operations":[...]}。',
  'operation 允许字段: action, entryId, sourceIds, kind, content, reason, evidence。',
  'action 仅允许 create/update/merge/archive/delete。',
  'kind 仅允许 profile/preference/project/rule/context/other。',
  '若无需变更，返回 {"operations":[]}。',
  '不要输出 Markdown，不要输出解释，不要包裹代码块。'
].join('\n');

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
}

function toEvidenceList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface LongTermMemoryRuntimeConfig {
  enabled: boolean;
  model?: string;
  retrievalProvider?: string;
  retrievalModel?: string;
  retrievalThreshold: number;
  retrievalTopK: number;
}

export class LongTermMemoryService {
  private log = logger.child('LongTermMemory');
  private maintenanceQueue: Map<string, Promise<void>> = new Map();
  private missingProviderWarned = false;
  private missingRetrievalWarned = false;

  constructor(
    private sessionManager: SessionManager,
    private store: LongTermMemoryStore,
    private config: LongTermMemoryRuntimeConfig,
    private provider?: LLMProvider,
    private retrievalClient?: OpenAIEmbeddingsClient
  ) {}

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getStore(): LongTermMemoryStore {
    return this.store;
  }

  private canRunBackgroundMaintenance(): boolean {
    return this.config.enabled && !!this.provider && !!this.config.model;
  }

  private canRunRecall(): boolean {
    return this.config.enabled
      && !!this.retrievalClient
      && !!this.config.retrievalProvider
      && !!this.config.retrievalModel;
  }

  async listEntries(channel: string, chatId: string): Promise<LongTermMemoryEntry[]> {
    return this.store.listEntries(channel, chatId, { statuses: ['active', 'archived'] });
  }

  async listRecentOperations(channel: string, chatId: string, limit = 10): Promise<LongTermMemoryOperation[]> {
    return this.store.listOperations(channel, chatId, limit);
  }

  async applyOperations(
    channel: string,
    chatId: string,
    operations: MemoryOperationInput[],
    actor: MemoryOperationActor
  ): Promise<MemoryOperationResult[]> {
    const normalized = operations.slice(0, MAX_BACKGROUND_ACTIONS);
    const results: MemoryOperationResult[] = [];

    for (const operation of normalized) {
      this.validateOperation(operation);
      results.push(await this.store.applyOperation(channel, chatId, operation, actor));
    }

    return results;
  }

  async deleteConversationEntries(channel: string, chatId: string, actor: MemoryOperationActor, reason: string): Promise<number> {
    return this.store.deleteConversationEntries(channel, chatId, actor, reason);
  }

  async deleteAllEntries(actor: MemoryOperationActor, reason: string): Promise<number> {
    return this.store.deleteAllEntries(actor, reason);
  }

  async buildRecallMessage(
    channel: string,
    chatId: string,
    request: Pick<InboundMessage, 'content'> & Partial<Pick<InboundMessage, 'media' | 'files'>>
  ): Promise<string | null> {
    const query = request.content?.trim() ?? '';
    const _hasMedia = Array.isArray(request.media) && request.media.length > 0;
    const _hasFiles = Array.isArray(request.files) && request.files.length > 0;

    if (!query) {
      return null;
    }

    if (!this.canRunRecall()) {
      if (!this.missingRetrievalWarned && this.config.enabled) {
        this.missingRetrievalWarned = true;
      }
      return null;
    }

    try {
      const candidates = await this.store.listActiveEntriesWithEmbeddings(
        channel,
        chatId,
        this.config.retrievalProvider!,
        this.config.retrievalModel!
      );

      if (candidates.length === 0) {
        return null;
      }

      const queryEmbedding = await this.retrievalClient!.embed(query, this.config.retrievalModel!);
      const preparedCandidates = await this.prepareCandidateEmbeddings(candidates);
      const evaluated: Array<{ entry: LongTermMemoryEntry; similarity: number }> = [];
      const scored: Array<{ entry: LongTermMemoryEntry; similarity: number }> = [];
      for (const candidate of preparedCandidates) {
        const embedding = candidate.embedding;
        if (!embedding || embedding.length === 0 || embedding.length !== queryEmbedding.length) {
          continue;
        }

        const similarity = cosineSimilarity(queryEmbedding, embedding);
        evaluated.push({
          entry: candidate.entry,
          similarity
        });
        if (similarity >= this.config.retrievalThreshold) {
          scored.push({
            entry: candidate.entry,
            similarity
          });
        }
      }

      if (scored.length === 0) {
        return null;
      }

      const selected = scored
        .slice()
        .sort((left, right) => {
          if (right.similarity !== left.similarity) {
            return right.similarity - left.similarity;
          }
          if (right.entry.confidence !== left.entry.confidence) {
            return right.entry.confidence - left.entry.confidence;
          }
          return (right.entry.updatedAt || '').localeCompare(left.entry.updatedAt || '');
        })
        .slice(0, this.config.retrievalTopK);

      return [
        '相关长期记忆（自动召回）',
        ...selected.map(({ entry }) => `[${entry.kind}] ${entry.content}`),
        '仅在与当前请求直接相关时使用；若不相关请忽略。'
      ].join('\n');
    } catch {
      return null;
    }
  }

  enqueueMaintenance(
    sessionKey: string,
    request: Pick<InboundMessage, 'content'> & Partial<Pick<InboundMessage, 'media' | 'files'>>,
    assistantContent: string
  ): void {
    if (!this.config.enabled) {
      return;
    }

    const queuedRequest = {
      content: request.content,
      media: Array.isArray(request.media) ? [...request.media] : request.media,
      files: Array.isArray(request.files) ? [...request.files] : request.files
    };
    const previous = this.maintenanceQueue.get(sessionKey) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        await this.maybeMaintain(sessionKey, queuedRequest, assistantContent);
      })
      .catch((_error) => {
      });

    this.maintenanceQueue.set(sessionKey, task);
    void task.finally(() => {
      if (this.maintenanceQueue.get(sessionKey) === task) {
        this.maintenanceQueue.delete(sessionKey);
      }
    });
  }

  private validateOperation(operation: MemoryOperationInput): void {
    const allowedKinds: MemoryEntryKind[] = ['profile', 'preference', 'project', 'rule', 'context', 'other'];
    if (!['create', 'update', 'merge', 'archive', 'delete'].includes(operation.action)) {
      throw new Error(`unsupported memory action: ${operation.action}`);
    }

    if (operation.kind && !allowedKinds.includes(operation.kind)) {
      throw new Error(`unsupported memory kind: ${operation.kind}`);
    }

    if (operation.action === 'create' && !(operation.content || '').trim()) {
      throw new Error('memory create requires content');
    }

    if (operation.action === 'update') {
      if (typeof operation.entryId !== 'number') {
        throw new Error('memory update requires entryId');
      }
      if (!(operation.content || '').trim() && !operation.kind) {
        throw new Error('memory update requires content or kind');
      }
    }

    if (operation.action === 'merge') {
      if (typeof operation.entryId !== 'number') {
        throw new Error('memory merge requires entryId');
      }
      if (!Array.isArray(operation.sourceIds) || operation.sourceIds.length === 0) {
        throw new Error('memory merge requires sourceIds');
      }
    }

    if ((operation.action === 'archive' || operation.action === 'delete') && typeof operation.entryId !== 'number') {
      throw new Error(`memory ${operation.action} requires entryId`);
    }
  }

  private async maybeMaintain(
    sessionKey: string,
    request: Pick<InboundMessage, 'content'> & Partial<Pick<InboundMessage, 'media' | 'files'>>,
    assistantContent: string
  ): Promise<void> {
    const hasText = request.content.trim().length > 0;
    const hasMedia = Array.isArray(request.media) && request.media.length > 0;
    const hasFiles = Array.isArray(request.files) && request.files.length > 0;

    if (!hasText && hasMedia && !hasFiles) {
      return;
    }

    if (!this.canRunBackgroundMaintenance()) {
      if (!this.missingProviderWarned) {
        this.missingProviderWarned = true;
      }
      return;
    }

    const session = await this.sessionManager.getOrCreate(sessionKey);
    const entries = await this.store.listEntries(session.channel, session.chatId, { statuses: ['active', 'archived'] });
    const response = await this.provider!.chat([
      {
        role: 'system',
        content: MEMORY_MANAGER_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: this.buildMaintenancePrompt(entries, request.content, assistantContent)
      }
    ], undefined, this.config.model, { reasoning: false });

    const operations = this.parseOperations(response.content || '');
    if (operations.length === 0) {
      return;
    }

    const limitedOperations = operations.slice(0, MAX_BACKGROUND_ACTIONS);
    await this.applyOperations(session.channel, session.chatId, limitedOperations, 'background');
  }

  private buildMaintenancePrompt(
    entries: LongTermMemoryEntry[],
    userContent: string,
    assistantContent: string
  ): string {
    const existingEntriesBlock = entries.length === 0
      ? '(无)'
      : entries.map((entry) => {
          return `#${entry.id} [${entry.status}] [${entry.kind}] ${entry.content} (confidence=${entry.confidence}, confirmations=${entry.confirmations})`;
        }).join('\n');

    return [
      `当前长期记忆:\n${existingEntriesBlock}`,
      `最新用户消息:\n${userContent || '(空)'}`,
      `最新助手回复:\n${assistantContent || '(空)'}`,
      `请判断是否需要修改长期记忆。最多输出 ${MAX_BACKGROUND_ACTIONS} 个 operations。`
    ].join('\n\n');
  }

  private parseOperations(rawContent: string): MemoryOperationInput[] {
    const trimmed = stripMarkdownCodeFence(rawContent);
    if (!trimmed) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }

    if (!isObject(parsed) || !Array.isArray(parsed.operations)) {
      return [];
    }

    return parsed.operations
      .filter((item): item is Record<string, unknown> => isObject(item))
      .map((item) => ({
        action: String(item.action || '') as MemoryOperationInput['action'],
        entryId: typeof item.entryId === 'number' ? item.entryId : undefined,
        sourceIds: Array.isArray(item.sourceIds)
          ? item.sourceIds.filter((value): value is number => typeof value === 'number')
          : undefined,
        kind: typeof item.kind === 'string' ? item.kind as MemoryEntryKind : undefined,
        content: typeof item.content === 'string' ? item.content.trim() : undefined,
        reason: typeof item.reason === 'string' ? item.reason.trim() : undefined,
        evidence: toEvidenceList(item.evidence)
      }))
      .filter((item) => !!item.action);
  }

  private async prepareCandidateEmbeddings(
    candidates: LongTermMemoryEntryWithEmbedding[]
  ): Promise<Array<{ entry: LongTermMemoryEntry; embedding?: number[] }>> {
    const prepared = candidates.map((candidate) => ({
      entry: candidate.entry,
      embedding: undefined as number[] | undefined
    }));
    const missing: Array<{ index: number; entry: LongTermMemoryEntry; contentHash: string }> = [];

    for (const [index, candidate] of candidates.entries()) {
      const contentHash = hashMemoryContent(candidate.entry.content);
      const cached = candidate.embedding;
      if (cached && cached.contentHash === contentHash && cached.embedding.length > 0) {
        prepared[index].embedding = cached.embedding;
        continue;
      }

      missing.push({
        index,
        entry: candidate.entry,
        contentHash
      });
    }

    if (missing.length === 0) {
      return prepared;
    }

    try {
      const embeddings = await this.retrievalClient!.embedMany(
        missing.map((item) => item.entry.content),
        this.config.retrievalModel!
      );

      await Promise.all(missing.map(async (item, index) => {
        const embedding = embeddings[index];
        if (!embedding || embedding.length === 0) {
          return;
        }

        prepared[item.index].embedding = embedding;
        await this.store.upsertEmbedding({
          entryId: item.entry.id,
          providerName: this.config.retrievalProvider!,
          model: this.config.retrievalModel!,
          contentHash: item.contentHash,
          embedding
        });
      }));
    } catch {
    }

    return prepared;
  }
}

function hashMemoryContent(content: string): string {
  return createHash('sha256').update(content.trim()).digest('hex');
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] || 0;
    const rightValue = right[index] || 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
