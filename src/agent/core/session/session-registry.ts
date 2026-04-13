import { logger } from '../../../platform/observability/logger.js';
import { LLMProviderType, type LLMConfig } from '../../../platform/llm/types.js';
import type { IConfigManager } from '../../../contracts/config-manager.js';
import type { IRoleManager } from '../../../contracts/role-manager.js';
import type { ISystemPromptBuilder } from '../../../contracts/system-prompt-builder.js';
import type { SessionOptions, SessionConfig } from './types.js';
import { DEFAULT_SESSION_CONFIG } from './types.js';
import type { SessionContext } from './session-context.js';
import { createSessionMetadata } from './session-context.js';
import type { MemoryConfig as MemoryConfigInternal } from '../memory/types.js';
import { SessionMemoryManager } from '../memory/session-memory-manager.js';
import type { MemoryConfig as MemoryConfigSchema } from '../../../features/config/schema.js';
import { AgentEngine } from '../engine.js';
import { mapProviderType } from '../../../platform/utils/llm-utils.js';
import { parseModelIdentifier } from '../../../platform/utils/model-parser.js';
import { DEFAULT_ROLE_ID } from '../../../features/roles/role-manager.js';

export interface SessionRegistryDependencies {
  configManager: IConfigManager;
  roleManager: IRoleManager;
  systemPromptBuilder: ISystemPromptBuilder;
}

export class SessionRegistry {
  private sessions: Map<string, SessionContext> = new Map();
  private chatToSession: Map<string, string> = new Map();
  private config: SessionConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private deps: SessionRegistryDependencies;

  constructor(deps: SessionRegistryDependencies) {
    this.deps = deps;
    this.config = { ...DEFAULT_SESSION_CONFIG };
    logger.info('SessionRegistry initialized');
  }

  private getDefaultLLMConfig(): LLMConfig {
    try {
      if (this.deps.configManager.isInitialized() && this.deps.roleManager.isInitialized()) {
        const config = this.deps.configManager.config;
        const defaultRole = this.deps.roleManager.getRoleConfig(DEFAULT_ROLE_ID);
        const modelIdentifier = defaultRole.model;
        const { providerName, modelAlias } = parseModelIdentifier(modelIdentifier);

        const providerDetails = config.providers[providerName];
        if (!providerDetails) {
          throw new Error(`Provider '${providerName}' not found`);
        }

        const modelConfig = providerDetails.models?.[modelAlias];
        if (!modelConfig) {
          throw new Error(`Model '${modelAlias}' not found in provider '${providerName}'`);
        }

        return {
          provider: mapProviderType(providerDetails.type),
          model: modelConfig.modelname,
          apiKey: providerDetails.api_key,
          baseUrl: providerDetails.base_url,
        };
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to get LLM config from config, using defaults');
    }

    return {
      provider: LLMProviderType.OpenAIChat,
      model: 'gpt-4o-mini',
    };
  }

  getOrCreate(sessionId: string, options: SessionOptions): SessionContext {
    if (this.sessions.has(sessionId)) {
      const existing = this.sessions.get(sessionId)!;
      existing.metadata.lastActiveAt = new Date();
      logger.debug({ sessionId }, '复用已存在的会话');
      return existing;
    }

    logger.debug({ sessionId, channel: options.channel, type: options.type, chatId: options.chatId }, '🆕 创建新会话');

    const { manager: memory, config: memoryConfig } = this.createMemory(sessionId, options);
    const agent = this.createAgent(sessionId, options, memory, memoryConfig);

    const metadata = createSessionMetadata(
      sessionId,
      options.channel,
      options.type,
      options.chatId,
      options.session
    );

    const context: SessionContext = {
      metadata,
      agent,
      memory,
      config: this.config,
    };

    this.sessions.set(sessionId, context);
    this.chatToSession.set(`${options.channel}:${options.type}:${options.chatId}`, sessionId);
    this.enforceMaxSessions(options.chatId);

    return context;
  }

  getSessionIdByChatId(channel: string, type: string, chatId: string): string | null {
    return this.chatToSession.get(`${channel}:${type}:${chatId}`) || null;
  }

  private createMemory(sessionId: string, options: SessionOptions): { manager: SessionMemoryManager; config: MemoryConfigInternal } {
    let memoryConfig: MemoryConfigInternal;

    if (options.memoryConfig) {
      memoryConfig = options.memoryConfig as MemoryConfigInternal;
    } else {
      const rawConfig = this.deps.configManager.config.memory as MemoryConfigSchema;
      memoryConfig = {
        maxContextTokens: rawConfig.max_context_tokens,
        compressionThreshold: rawConfig.compression_threshold,
      };
    }

    const manager = new SessionMemoryManager(sessionId, memoryConfig, {
      systemPromptBuilder: this.deps.systemPromptBuilder,
      roleManager: this.deps.roleManager,
    });
    return { manager, config: memoryConfig };
  }

  private createAgent(sessionId: string, options: SessionOptions, memory: SessionMemoryManager, memoryConfig: MemoryConfigInternal) {
    const llmConfig = options.llm || this.getDefaultLLMConfig();
    const maxSteps = options.maxSteps || this.deps.configManager.config.agent.max_steps || 50;
    const systemPrompt = options.systemPrompt || this.deps.systemPromptBuilder.buildSystemPrompt({
      roleId: DEFAULT_ROLE_ID,
      chatId: options.chatId,
    });

    return new AgentEngine(sessionId, {
      llm: llmConfig,
      maxSteps,
      systemPrompt,
      memory,
      memoryConfig: memoryConfig,
    });
  }

  private enforceMaxSessions(chatId: string): void {
    const sessionsForChat = this.getSessionsByChatId(chatId);

    if (sessionsForChat.length > this.config.maxSessionsPerChat) {
      const sortedSessions = sessionsForChat.sort(
        (a, b) => a.metadata.lastActiveAt.getTime() - b.metadata.lastActiveAt.getTime()
      );

      const toRemove = sortedSessions.slice(0, sessionsForChat.length - this.config.maxSessionsPerChat);
      for (const session of toRemove) {
        this.removeSession(session.metadata.sessionId);
        logger.info({ sessionId: session.metadata.sessionId }, '清理超出限制的旧会话');
      }
    }
  }

  getSession(sessionId: string): SessionContext | undefined {
    return this.sessions.get(sessionId);
  }

  removeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      const key = `${session.metadata.channel}:${session.metadata.type}:${session.metadata.chatId}`;
      this.chatToSession.delete(key);
      session.memory.clear();
      this.sessions.delete(sessionId);
      logger.info({ sessionId }, '会话已删除');
      return true;
    }
    return false;
  }

  getAllSessions(): SessionContext[] {
    return Array.from(this.sessions.values());
  }

  getSessionsByChatId(chatId: string): SessionContext[] {
    return this.getAllSessions().filter(s => s.metadata.chatId === chatId);
  }

  cleanupInactive(maxAge: number): void {
    const now = Date.now();
    const sessionsToRemove: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      const age = now - session.metadata.lastActiveAt.getTime();
      if (age > maxAge) {
        sessionsToRemove.push(sessionId);
      }
    }

    for (const sessionId of sessionsToRemove) {
      this.removeSession(sessionId);
    }

    if (sessionsToRemove.length > 0) {
      logger.info({ count: sessionsToRemove.length }, '🧹 不活跃会话已清理');
    }
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  getStats(): { total: number; byChannel: Record<string, number>; byType: Record<string, number> } {
    const sessions = this.getAllSessions();
    const byChannel: Record<string, number> = {};
    const byType: Record<string, number> = {};

    for (const session of sessions) {
      byChannel[session.metadata.channel] = (byChannel[session.metadata.channel] || 0) + 1;
      byType[session.metadata.type] = (byType[session.metadata.type] || 0) + 1;
    }

    return {
      total: sessions.length,
      byChannel,
      byType,
    };
  }

  startAutoCleanup(intervalMs: number = 3600000): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      if (this.config.autoCleanup) {
        this.cleanupInactive(this.config.sessionTTL);
      }
    }, intervalMs);

    logger.info({ intervalMs }, '自动清理已启动');
  }

  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info({}, '自动清理已停止');
    }
  }

  shutdown(): void {
    this.stopAutoCleanup();
    for (const session of this.sessions.values()) {
      session.memory.clear();
    }
    this.sessions.clear();
    logger.info({}, 'SessionRegistry shutdown');
  }
}

import { configManager } from '../../../features/config/config-manager.js';
import { roleManager } from '../../../features/roles/role-manager.js';
import { systemPromptManager } from '../../../features/roles/system-prompt-manager.js';

let sessionRegistryInstance: SessionRegistry | null = null;

export function createSessionRegistry(): SessionRegistry {
  if (!sessionRegistryInstance) {
    sessionRegistryInstance = new SessionRegistry({
      configManager: configManager as unknown as IConfigManager,
      roleManager: roleManager as unknown as IRoleManager,
      systemPromptBuilder: systemPromptManager as unknown as ISystemPromptBuilder,
    });
  }
  return sessionRegistryInstance;
}

export const sessionRegistry = createSessionRegistry();
