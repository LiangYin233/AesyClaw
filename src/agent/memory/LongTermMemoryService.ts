import type { InboundMessage } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';
import type { SessionManager } from '../../session/SessionManager.js';
import {
  LongTermMemoryStore,
  type LongTermMemoryEntry,
  type LongTermMemoryOperation,
  type MemoryEntryKind,
  type MemoryOperationActor,
  type MemoryOperationInput,
  type MemoryOperationResult
} from '../../session/LongTermMemoryStore.js';
import { logger } from '../../observability/index.js';

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
}

export class LongTermMemoryService {
  private log = logger.child('LongTermMemory');
  private maintenanceQueue: Map<string, Promise<void>> = new Map();
  private missingProviderWarned = false;

  constructor(
    private sessionManager: SessionManager,
    private store: LongTermMemoryStore,
    private config: LongTermMemoryRuntimeConfig,
    private provider?: LLMProvider
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
      .catch((error) => {
        this.log.warn('后台长期记忆维护失败', { sessionKey, error });
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
      this.log.debug('Skip long-term memory maintenance for pure image message', { sessionKey, mediaCount: request.media?.length || 0 });
      return;
    }

    if (!this.canRunBackgroundMaintenance()) {
      if (!this.missingProviderWarned) {
        this.missingProviderWarned = true;
        this.log.warn('长期记忆已启用，但未完整配置 provider/model，已跳过后台记忆维护');
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
    const results = await this.applyOperations(session.channel, session.chatId, limitedOperations, 'background');
    this.log.info('长期记忆已自动维护', {
      channel: session.channel,
      chatId: session.chatId,
      appliedCount: results.filter((result) => result.changed).length,
      operationCount: limitedOperations.length
    });
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
    } catch (error) {
      this.log.warn('长期记忆维护返回了无效 JSON，已忽略', { error, preview: trimmed.slice(0, 500) });
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
}
