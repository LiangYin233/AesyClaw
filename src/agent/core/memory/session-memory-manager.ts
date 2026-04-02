import { StandardMessage, MessageRole } from '../../llm/types';
import {
  MemoryConfig,
  MemoryStats,
  CompressionPhase,
  MemoryEvent,
  TokenBudget,
  createMemoryConfig,
} from './types';
import { TokenBudgetCalculator } from './token-budget-calculator';
import { MessageTrimmer } from './message-trimmer';
import { LosslessSummarizer } from './lossless-summarizer';
import { logger } from '../../../platform/observability/logger';

export class SessionMemoryManager {
  readonly chatId: string;
  private messages: StandardMessage[] = [];
  private config: MemoryConfig;
  private calculator: TokenBudgetCalculator;
  private trimmer: MessageTrimmer;
  private summarizer: LosslessSummarizer;
  private currentPhase: CompressionPhase = CompressionPhase.Idle;
  private compressionCount: number = 0;
  private lastCompressionTime?: Date;
  private eventListeners: Array<(event: MemoryEvent) => void> = [];

  constructor(chatId: string, config?: Partial<MemoryConfig>) {
    this.chatId = chatId;
    this.config = createMemoryConfig(config);
    
    this.calculator = new TokenBudgetCalculator(this.config);
    this.trimmer = new MessageTrimmer(this.config, this.calculator);
    this.summarizer = new LosslessSummarizer(this.config, this.calculator);

    logger.info(
      { 
        chatId: this.chatId,
        maxTokens: this.config.maxContextTokens,
        compressionThreshold: this.config.compressionThreshold,
      },
      '🧠 SessionMemoryManager 已初始化'
    );
  }

  updateConfig(config: Partial<MemoryConfig>): void {
    this.config = { ...this.config, ...config };
    this.calculator.updateConfig(config);
    this.trimmer.updateConfig(config);
    this.summarizer.updateConfig(config);
    logger.debug({ chatId: this.chatId, config: this.config }, '📝 记忆配置已更新');
  }

  addMessage(message: StandardMessage): void {
    this.currentPhase = CompressionPhase.Monitoring;
    
    const { message: processedMessage, result } = this.trimmer.checkAndTrim(message);
    
    if (result?.wasTruncated) {
      logger.warn(
        { 
          chatId: this.chatId,
          originalLength: result.originalLength,
          truncatedLength: result.truncatedLength,
          savings: `${this.trimmer.calculateSavingsPercentage(result).toFixed(2)}%`,
        },
        '✂️ 消息被物理截断'
      );
      this.emitEvent({
        type: 'truncated',
        timestamp: new Date(),
        details: { truncationDetails: result },
      });
    }

    this.messages.push(processedMessage as StandardMessage);
    
    this.emitEvent({
      type: 'message_added',
      timestamp: new Date(),
      details: {
        messageCount: this.messages.length,
        tokenCount: this.checkBudget().currentTokens,
      },
    });

    const budget = this.checkBudget();
    
    if (budget.needsCompression) {
      logger.info(
        { 
          chatId: this.chatId,
          currentTokens: budget.currentTokens,
          threshold: this.config.compressionThreshold,
        },
        '⚠️ Token 预算超限，触发压缩协议'
      );
      this.triggerCompression();
    }

    this.currentPhase = CompressionPhase.Idle;
  }

  getMessages(): StandardMessage[] {
    return [...this.messages];
  }

  getMessagesForLLM(): StandardMessage[] {
    return this.messages;
  }

  checkBudget(): TokenBudget {
    return this.calculator.calculate(this.messages);
  }

  getStats(): MemoryStats {
    const budget = this.checkBudget();
    const sacredCount = this.messages.filter(
      msg => msg.role === MessageRole.System || msg.role === MessageRole.User
    ).length;
    const compressibleCount = this.messages.length - sacredCount;

    return {
      totalMessages: this.messages.length,
      totalTokens: budget.currentTokens,
      sacredMessages: sacredCount,
      compressibleMessages: compressibleCount,
      compressionCount: this.compressionCount,
      lastCompressionTime: this.lastCompressionTime,
      currentPhase: this.currentPhase,
    };
  }

  private async triggerCompression(): Promise<void> {
    this.currentPhase = CompressionPhase.SieveProcess;
    logger.info({ chatId: this.chatId }, '🔍 阶段一：安全分拣中...');

    const zones = this.summarizer.sieveMessages(this.messages);
    
    const sacredZones = zones.filter(z => z.zone === 'sacred');
    const compressibleZones = zones.filter(z => z.zone === 'compressible');

    logger.info(
      {
        chatId: this.chatId,
        totalZones: zones.length,
        sacredZones: sacredZones.length,
        compressibleZones: compressibleZones.length,
      },
      '✅ 分拣完成，准备压缩'
    );

    this.currentPhase = CompressionPhase.LLMDrivenSummarization;
    logger.info({ chatId: this.chatId }, '🤖 阶段二：AI 降维打击中...');

    try {
      const compressionResult = await this.summarizer.summarize(zones);
      
      this.currentPhase = CompressionPhase.Reassembly;
      logger.info({ chatId: this.chatId }, '🔄 阶段三：上下文重组中...');

      this.messages = this.summarizer.reassemble(zones, compressionResult);
      
      this.compressionCount++;
      this.lastCompressionTime = new Date();

      const newBudget = this.checkBudget();

      logger.info(
        {
          chatId: this.chatId,
          originalTokens: compressionResult.originalTokens,
          compressedTokens: compressionResult.compressedTokens,
          compressionRatio: `${(compressionResult.compressionRatio * 100).toFixed(2)}%`,
          newTokenCount: newBudget.currentTokens,
          totalMessages: this.messages.length,
        },
        '🎉 压缩流水线执行完成'
      );

      this.emitEvent({
        type: 'compressed',
        timestamp: new Date(),
        details: {
          tokenCount: newBudget.currentTokens,
          compressionRatio: compressionResult.compressionRatio,
        },
      });

      this.currentPhase = CompressionPhase.Idle;
    } catch (error) {
      logger.error({ chatId: this.chatId, error }, '❌ 压缩流水线执行失败');
      this.currentPhase = CompressionPhase.Idle;
      throw error;
    }
  }

  clear(): void {
    this.messages = [];
    this.calculator.clearCache();
    this.compressionCount = 0;
    this.lastCompressionTime = undefined;
    this.currentPhase = CompressionPhase.Idle;
    
    logger.debug({ chatId: this.chatId }, '🗑️ 会话记忆已清空');
    
    this.emitEvent({
      type: 'reset',
      timestamp: new Date(),
      details: {},
    });
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  getTokenCount(): number {
    return this.checkBudget().currentTokens;
  }

  hasMessages(): boolean {
    return this.messages.length > 0;
  }

  getLastMessage(): StandardMessage | undefined {
    return this.messages[this.messages.length - 1];
  }

  getLastNMessages(n: number): StandardMessage[] {
    return this.messages.slice(-n);
  }

  removeMessages(count: number): StandardMessage[] {
    if (count >= this.messages.length) {
      const removed = [...this.messages];
      this.messages = [];
      return removed;
    }
    
    const removed = this.messages.splice(this.messages.length - count, count);
    logger.debug({ chatId: this.chatId, removedCount: removed.length }, '🗑️ 移除了部分历史消息');
    return removed;
  }

  onEvent(listener: (event: MemoryEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index > -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  private emitEvent(event: MemoryEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error({ error, eventType: event.type }, '❌ 记忆事件监听器执行失败');
      }
    }
  }

  exportMemory(): {
    chatId: string;
    messages: StandardMessage[];
    stats: MemoryStats;
    config: MemoryConfig;
  } {
    return {
      chatId: this.chatId,
      messages: this.getMessages(),
      stats: this.getStats(),
      config: this.config,
    };
  }

  importMemory(data: { messages: StandardMessage[]; config?: Partial<MemoryConfig> }): void {
    if (data.config) {
      this.updateConfig(data.config);
    }
    
    this.messages = [...data.messages];
    this.calculator.clearCache();
    
    logger.info(
      { 
        chatId: this.chatId,
        importedMessages: this.messages.length,
      },
      '📥 记忆已导入'
    );
  }

  validateIntegrity(): boolean {
    if (this.messages.length === 0) return true;

    const hasSystemPrompt = this.messages[0]?.role === MessageRole.System;
    const hasContinuouslyUserMessages = this.validateUserMessageContinuity();
    
    return hasSystemPrompt && hasContinuouslyUserMessages;
  }

  private validateUserMessageContinuity(): boolean {
    for (let i = 1; i < this.messages.length; i++) {
      const prev = this.messages[i - 1];
      const curr = this.messages[i];
      
      if (prev.role === MessageRole.User && curr.role === MessageRole.Tool) {
        return false;
      }
    }
    return true;
  }

  getCurrentPhase(): CompressionPhase {
    return this.currentPhase;
  }

  isCompressing(): boolean {
    return this.currentPhase !== CompressionPhase.Idle;
  }

  getCompressionCount(): number {
    return this.compressionCount;
  }

  getLastCompressionTime(): Date | undefined {
    return this.lastCompressionTime;
  }
}

export class MemoryManagerFactory {
  private static instance: MemoryManagerFactory;
  private memories: Map<string, SessionMemoryManager> = new Map();
  private defaultConfig?: Partial<MemoryConfig>;

  private constructor() {
    logger.info('🏭 MemoryManagerFactory 已初始化');
  }

  static getInstance(): MemoryManagerFactory {
    if (!MemoryManagerFactory.instance) {
      MemoryManagerFactory.instance = new MemoryManagerFactory();
    }
    return MemoryManagerFactory.instance;
  }

  setDefaultConfig(config: Partial<MemoryConfig>): void {
    this.defaultConfig = config;
    logger.debug({ config: this.defaultConfig }, '📝 记忆工厂默认配置已设置');
  }

  getOrCreate(chatId: string): SessionMemoryManager {
    if (!this.memories.has(chatId)) {
      const memory = new SessionMemoryManager(chatId, this.defaultConfig);
      this.memories.set(chatId, memory);
      logger.debug({ chatId, totalMemories: this.memories.size }, '🆕 创建新的记忆实例');
    } else {
      logger.debug({ chatId, totalMemories: this.memories.size }, '♻️ 复用已存在的记忆实例');
    }
    
    return this.memories.get(chatId)!;
  }

  hasMemory(chatId: string): boolean {
    return this.memories.has(chatId);
  }

  removeMemory(chatId: string): boolean {
    const deleted = this.memories.delete(chatId);
    if (deleted) {
      logger.info({ chatId, remainingMemories: this.memories.size }, '🗑️ 记忆实例已移除');
    }
    return deleted;
  }

  getActiveMemoryCount(): number {
    return this.memories.size;
  }

  getAllChatIds(): string[] {
    return Array.from(this.memories.keys());
  }

  clearAll(): void {
    this.memories.clear();
    logger.info('🗑️ 所有记忆实例已清空');
  }
}
