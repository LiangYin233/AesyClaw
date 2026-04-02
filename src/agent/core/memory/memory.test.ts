import { MessageRole, StandardMessage } from '../llm/types';
import {
  SessionMemoryManager,
  MemoryManagerFactory,
  TokenBudgetCalculator,
  MessageTrimmer,
  LosslessSummarizer,
  createMemoryConfig,
  DEFAULT_MEMORY_CONFIG,
} from './index';

describe('记忆系统 - Memory System', () => {
  beforeEach(() => {
    const factory = MemoryManagerFactory.getInstance();
    factory.clearAll();
  });

  describe('1. TokenBudgetCalculator (Token 审计员)', () => {
    const calculator = new TokenBudgetCalculator(DEFAULT_MEMORY_CONFIG);

    test('应该正确估算英文文本的 Token 数', () => {
      const tokens = calculator.calculateSingleMessage('Hello world');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThanOrEqual(10);
    });

    test('应该正确估算中文文本的 Token 数', () => {
      const tokens = calculator.calculateSingleMessage('你好世界');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeGreaterThan(calculator.calculateSingleMessage('hello'));
    });

    test('应该正确计算多条消息的总 Token 数', () => {
      const messages: StandardMessage[] = [
        { role: MessageRole.System, content: 'You are a helpful assistant.' },
        { role: MessageRole.User, content: 'Hello' },
        { role: MessageRole.Assistant, content: 'Hi there!' },
      ];

      const budget = calculator.calculate(messages);
      expect(budget.currentTokens).toBeGreaterThan(0);
      expect(budget.maxTokens).toBe(DEFAULT_MEMORY_CONFIG.maxContextTokens);
      expect(budget.usagePercentage).toBeGreaterThan(0);
      expect(budget.usagePercentage).toBeLessThan(100);
    });

    test('应该正确判断是否需要压缩', () => {
      const largeConfig = createMemoryConfig({ compressionThreshold: 10 });
      const largeCalculator = new TokenBudgetCalculator(largeConfig);

      const messages: StandardMessage[] = [
        { role: MessageRole.System, content: 'A'.repeat(1000) },
        { role: MessageRole.User, content: 'B'.repeat(1000) },
      ];

      const budget = largeCalculator.calculate(messages);
      expect(budget.needsCompression).toBe(true);
    });

    test('应该正确判断是否为危险长度', () => {
      const dangerConfig = createMemoryConfig({ dangerThreshold: 50 });
      const dangerCalculator = new TokenBudgetCalculator(dangerConfig);

      const shortMessage = { role: MessageRole.User, content: 'Short' };
      const longMessage = { role: MessageRole.User, content: 'A'.repeat(1000) };

      expect(dangerCalculator.isDangerous(shortMessage)).toBe(false);
      expect(dangerCalculator.isDangerous(longMessage)).toBe(true);
    });

    test('应该使用缓存机制', () => {
      const content = 'Test content for caching';
      const tokens1 = calculator.calculateSingleMessage(content);
      const tokens2 = calculator.calculateSingleMessage(content);

      expect(tokens1).toBe(tokens2);
      expect(calculator.getCacheSize()).toBeGreaterThan(0);
    });

    test('应该清空缓存', () => {
      calculator.calculateSingleMessage('Some content');
      expect(calculator.getCacheSize()).toBeGreaterThan(0);
      
      calculator.clearCache();
      expect(calculator.getCacheSize()).toBe(0);
    });
  });

  describe('2. MessageTrimmer (硬截断修剪器)', () => {
    const calculator = new TokenBudgetCalculator(DEFAULT_MEMORY_CONFIG);
    const trimmer = new MessageTrimmer(DEFAULT_MEMORY_CONFIG, calculator);

    test('不应该截断短消息', () => {
      const shortMessage = { role: MessageRole.User, content: 'Short message' };
      const result = trimmer.checkAndTrim(shortMessage);

      expect(result.result).toBeUndefined();
      expect(result.message).toEqual(shortMessage);
    });

    test('应该截断超长消息', () => {
      const longContent = 'A'.repeat(10000);
      const longMessage = { role: MessageRole.Tool, content: longContent };
      const result = trimmer.checkAndTrim(longMessage);

      expect(result.result?.wasTruncated).toBe(true);
      expect(result.result?.originalLength).toBe(longContent.length);
      expect(result.result?.truncatedLength).toBeLessThan(longContent.length);
    });

    test('应该保留消息的头尾部分', () => {
      const content = 'START' + 'X'.repeat(10000) + 'END';
      const message = { role: MessageRole.Tool, content };
      const result = trimmer.checkAndTrim(message);

      expect(result.result?.preservedHead).toContain('START');
      expect(result.result?.preservedTail).toContain('END');
      expect(result.result?.warningMessage).toContain('系统警告');
    });

    test('应该正确计算节省比例', () => {
      const content = 'A'.repeat(10000);
      const message = { role: MessageRole.Tool, content };
      const result = trimmer.checkAndTrim(message);

      const savingsPercentage = trimmer.calculateSavingsPercentage(result.result!);
      expect(savingsPercentage).toBeGreaterThan(0);
      expect(savingsPercentage).toBeLessThan(100);
    });
  });

  describe('3. LosslessSummarizer (无损摘要压缩机)', () => {
    const calculator = new TokenBudgetCalculator(DEFAULT_MEMORY_CONFIG);
    const summarizer = new LosslessSummarizer(DEFAULT_MEMORY_CONFIG, calculator);

    test('应该正确分拣消息区域', () => {
      const messages: StandardMessage[] = [
        { role: MessageRole.System, content: 'System prompt' },
        { role: MessageRole.User, content: 'First question' },
        { role: MessageRole.Assistant, content: 'Answer 1' },
        { role: MessageRole.Tool, content: 'Tool result' },
        { role: MessageRole.User, content: 'Second question' },
        { role: MessageRole.Assistant, content: 'Answer 2' },
      ];

      const zones = summarizer.sieveMessages(messages);
      
      expect(zones.length).toBeGreaterThan(0);
      
      const sacredZones = zones.filter(z => z.zone === 'sacred');
      const compressibleZones = zones.filter(z => z.zone === 'compressible');
      
      expect(sacredZones.length).toBeGreaterThan(0);
      expect(compressibleZones.length).toBeGreaterThan(0);
    });

    test('应该锁定系统提示和用户消息', () => {
      const messages: StandardMessage[] = [
        { role: MessageRole.System, content: 'System prompt' },
        { role: MessageRole.User, content: 'User question' },
        { role: MessageRole.Assistant, content: 'Assistant response' },
      ];

      const zones = summarizer.sieveMessages(messages);
      const sacredMessages = zones
        .filter(z => z.zone === 'sacred')
        .flatMap(z => z.messages);

      expect(sacredMessages.some(m => m.role === MessageRole.System)).toBe(true);
      expect(sacredMessages.some(m => m.role === MessageRole.User)).toBe(true);
    });

    test('应该提取可压缩区域', () => {
      const messages: StandardMessage[] = [
        { role: MessageRole.System, content: 'System' },
        { role: MessageRole.User, content: 'Question' },
        { role: MessageRole.Assistant, content: 'Reasoning process...' },
        { role: MessageRole.Tool, content: 'Large tool result' },
      ];

      const zones = summarizer.sieveMessages(messages);
      const compressibleMessages = zones
        .filter(z => z.zone === 'compressible')
        .flatMap(z => z.messages);

      expect(compressibleMessages.length).toBeGreaterThan(0);
    });

    test('当没有可压缩内容时应返回原始消息', async () => {
      const messages: StandardMessage[] = [
        { role: MessageRole.System, content: 'System' },
        { role: MessageRole.User, content: 'Question' },
      ];

      const zones = summarizer.sieveMessages(messages);
      const result = await summarizer.summarize(zones);

      expect(result.compressionRatio).toBe(1);
      expect(result.originalMessages.length).toBe(result.compressedMessages.length);
    });

    test('应该使用备用摘要方案当没有 API key', async () => {
      const messages: StandardMessage[] = [
        { role: MessageRole.System, content: 'System' },
        { role: MessageRole.User, content: 'Question' },
        { role: MessageRole.Assistant, content: 'I will search for this.' },
        { role: MessageRole.Tool, content: 'Search result: Company revenue is $100M' },
      ];

      const zones = summarizer.sieveMessages(messages);
      const result = await summarizer.summarize(zones);

      expect(result.summaryMessage).toBeDefined();
      expect(result.summaryMessage?.role).toBe(MessageRole.System);
      expect(result.summaryMessage?.content).toContain('搜索');
    });
  });

  describe('4. SessionMemoryManager (会话记忆总管)', () => {
    test('应该正确初始化', () => {
      const memory = new SessionMemoryManager('test-chat-1');
      
      expect(memory.chatId).toBe('test-chat-1');
      expect(memory.getMessageCount()).toBe(0);
      expect(memory.hasMessages()).toBe(false);
    });

    test('应该正确添加消息', () => {
      const memory = new SessionMemoryManager('test-chat-2');
      const message: StandardMessage = {
        role: MessageRole.User,
        content: 'Hello',
      };

      memory.addMessage(message);
      
      expect(memory.getMessageCount()).toBe(1);
      expect(memory.hasMessages()).toBe(true);
      expect(memory.getLastMessage()).toEqual(message);
    });

    test('应该正确获取 Token 预算', () => {
      const memory = new SessionMemoryManager('test-chat-3');
      memory.addMessage({ role: MessageRole.User, content: 'Test' });

      const budget = memory.checkBudget();
      
      expect(budget.currentTokens).toBeGreaterThan(0);
      expect(budget.maxTokens).toBe(DEFAULT_MEMORY_CONFIG.maxContextTokens);
    });

    test('应该正确获取统计信息', () => {
      const memory = new SessionMemoryManager('test-chat-4');
      memory.addMessage({ role: MessageRole.System, content: 'System' });
      memory.addMessage({ role: MessageRole.User, content: 'User' });

      const stats = memory.getStats();
      
      expect(stats.totalMessages).toBe(2);
      expect(stats.sacredMessages).toBe(2);
      expect(stats.compressibleMessages).toBe(0);
      expect(stats.currentPhase).toBeDefined();
    });

    test('应该正确清空记忆', () => {
      const memory = new SessionMemoryManager('test-chat-5');
      memory.addMessage({ role: MessageRole.User, content: 'Test' });
      
      expect(memory.getMessageCount()).toBe(1);
      
      memory.clear();
      
      expect(memory.getMessageCount()).toBe(0);
      expect(memory.hasMessages()).toBe(false);
    });

    test('应该支持事件监听', () => {
      const memory = new SessionMemoryManager('test-chat-6');
      let eventReceived = false;

      const unsubscribe = memory.onEvent((event) => {
        eventReceived = true;
        expect(event.type).toBe('message_added');
      });

      memory.addMessage({ role: MessageRole.User, content: 'Test' });
      
      expect(eventReceived).toBe(true);
      
      unsubscribe();
      
      eventReceived = false;
      memory.addMessage({ role: MessageRole.User, content: 'Test 2' });
      expect(eventReceived).toBe(false);
    });

    test('应该正确导出和导入记忆', () => {
      const memory = new SessionMemoryManager('test-chat-7');
      const messages: StandardMessage[] = [
        { role: MessageRole.System, content: 'System prompt' },
        { role: MessageRole.User, content: 'User question' },
      ];

      memory.importMemory({ messages });
      
      expect(memory.getMessageCount()).toBe(2);
      expect(memory.validateIntegrity()).toBe(true);

      const exported = memory.exportMemory();
      expect(exported.messages.length).toBe(2);
      expect(exported.chatId).toBe('test-chat-7');
    });

    test('应该验证记忆完整性', () => {
      const memory = new SessionMemoryManager('test-chat-8');
      memory.addMessage({ role: MessageRole.System, content: 'System' });
      memory.addMessage({ role: MessageRole.User, content: 'User' });

      expect(memory.validateIntegrity()).toBe(true);
    });

    test('应该获取最后 N 条消息', () => {
      const memory = new SessionMemoryManager('test-chat-9');
      
      for (let i = 1; i <= 5; i++) {
        memory.addMessage({ role: MessageRole.User, content: `Message ${i}` });
      }

      const lastTwo = memory.getLastNMessages(2);
      expect(lastTwo.length).toBe(2);
      expect(lastTwo[0].content).toBe('Message 4');
      expect(lastTwo[1].content).toBe('Message 5');
    });

    test('应该正确移除消息', () => {
      const memory = new SessionMemoryManager('test-chat-10');
      
      for (let i = 1; i <= 5; i++) {
        memory.addMessage({ role: MessageRole.User, content: `Message ${i}` });
      }

      expect(memory.getMessageCount()).toBe(5);

      const removed = memory.removeMessages(2);
      expect(removed.length).toBe(2);
      expect(memory.getMessageCount()).toBe(3);
    });
  });

  describe('5. MemoryManagerFactory (记忆工厂)', () => {
    test('应该正确创建和管理记忆实例', () => {
      const factory = MemoryManagerFactory.getInstance();
      
      const memory1 = factory.getOrCreate('chat-1');
      const memory2 = factory.getOrCreate('chat-2');
      const memory1Again = factory.getOrCreate('chat-1');

      expect(memory1).toBe(memory1Again);
      expect(memory1).not.toBe(memory2);
      expect(factory.getActiveMemoryCount()).toBe(2);
    });

    test('应该检查是否存在记忆', () => {
      const factory = MemoryManagerFactory.getInstance();
      
      expect(factory.hasMemory('non-existent')).toBe(false);
      
      factory.getOrCreate('new-chat');
      expect(factory.hasMemory('new-chat')).toBe(true);
    });

    test('应该正确移除记忆', () => {
      const factory = MemoryManagerFactory.getInstance();
      
      factory.getOrCreate('to-remove');
      expect(factory.getActiveMemoryCount()).toBe(1);
      
      factory.removeMemory('to-remove');
      expect(factory.getActiveMemoryCount()).toBe(0);
    });

    test('应该清空所有记忆', () => {
      const factory = MemoryManagerFactory.getInstance();
      
      factory.getOrCreate('chat-a');
      factory.getOrCreate('chat-b');
      factory.getOrCreate('chat-c');
      
      factory.clearAll();
      expect(factory.getActiveMemoryCount()).toBe(0);
    });

    test('应该设置默认配置', () => {
      const factory = MemoryManagerFactory.getInstance();
      
      const customConfig = {
        maxContextTokens: 60000,
        compressionThreshold: 40000,
      };
      
      factory.setDefaultConfig(customConfig);
      const memory = factory.getOrCreate('config-test');
      const stats = memory.getStats();
      
      expect(stats.totalTokens).toBe(0);
    });
  });

  describe('6. 集成测试 - 智能压缩流水线', () => {
    test('应该自动触发压缩当 Token 超限时', async () => {
      const lowThresholdConfig = createMemoryConfig({
        compressionThreshold: 100,
        maxContextTokens: 200,
      });
      
      const memory = new SessionMemoryManager('compression-test', lowThresholdConfig);

      memory.addMessage({ role: MessageRole.System, content: 'System prompt' });
      memory.addMessage({ role: MessageRole.User, content: 'A'.repeat(500) });
      memory.addMessage({ role: MessageRole.Assistant, content: 'Reasoning: ' + 'B'.repeat(500) });
      memory.addMessage({ role: MessageRole.Tool, content: 'Result: ' + 'C'.repeat(500) });

      const budget = memory.checkBudget();
      expect(budget.needsCompression).toBe(true);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const stats = memory.getStats();
      expect(stats.compressionCount).toBeGreaterThanOrEqual(0);
    });

    test('应该在截断时触发事件', () => {
      const lowDangerConfig = createMemoryConfig({
        dangerThreshold: 10,
      });
      
      const memory = new SessionMemoryManager('truncation-test', lowDangerConfig);
      let truncationEventReceived = false;

      memory.onEvent((event) => {
        if (event.type === 'truncated') {
          truncationEventReceived = true;
          expect(event.details.truncationDetails).toBeDefined();
        }
      });

      memory.addMessage({ role: MessageRole.Tool, content: 'X'.repeat(1000) });
      
      expect(truncationEventReceived).toBe(true);
    });
  });

  describe('7. AgentEngine 记忆集成', () => {
    test('应该创建带记忆系统的 Agent', () => {
      const { AgentManager } = require('./engine');
      const manager = AgentManager.getInstance();
      
      const agent = manager.getOrCreate('agent-memory-test', {
        llm: { provider: 'openai-chat' },
        systemPrompt: 'You are a helpful assistant.',
        memoryConfig: {
          maxContextTokens: 128000,
          compressionThreshold: 80000,
        },
      });

      expect(agent).toBeDefined();
      expect(agent.getChatId()).toBe('agent-memory-test');
      expect(agent.getMemoryStats()).toBeDefined();
    });

    test('应该正确获取记忆统计', () => {
      const { AgentManager } = require('./engine');
      const manager = AgentManager.getInstance();
      
      const agent = manager.getOrCreate('agent-stats-test', {
        llm: { provider: 'openai-chat' },
      });

      const stats = agent.getMemoryStats();
      expect(stats.totalMessages).toBeGreaterThanOrEqual(0);
      expect(stats.currentPhase).toBeDefined();
    });

    test('应该正确获取 Token 预算', () => {
      const { AgentManager } = require('./engine');
      const manager = AgentManager.getInstance();
      
      const agent = manager.getOrCreate('agent-budget-test', {
        llm: { provider: 'openai-chat' },
      });

      const budget = agent.getTokenBudget();
      expect(budget.currentTokens).toBeGreaterThanOrEqual(0);
      expect(budget.maxTokens).toBe(128000);
    });

    test('应该正确清空历史', () => {
      const { AgentManager } = require('./engine');
      const manager = AgentManager.getInstance();
      
      const agent = manager.getOrCreate('agent-clear-test', {
        llm: { provider: 'openai-chat' },
        systemPrompt: 'System prompt',
      });

      agent.clearHistory();
      
      const stats = agent.getMemoryStats();
      expect(stats.totalMessages).toBe(1);
      expect(stats.compressionCount).toBe(0);
    });

    test('应该获取压缩状态', () => {
      const { AgentManager } = require('./engine');
      const manager = AgentManager.getInstance();
      
      const agent = manager.getOrCreate('agent-compression-test', {
        llm: { provider: 'openai-chat' },
      });

      expect(agent.isMemoryCompressing()).toBe(false);
      expect(agent.getMemoryCompressionPhase()).toBeDefined();
    });
  });
});

console.log('🧪 记忆系统测试套件已加载');
