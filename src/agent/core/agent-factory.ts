import { logger } from '../../platform/observability/logger';

export class AgentEngine {
  private readonly chatId: string;
  private instanceId: string;

  constructor(chatId: string) {
    this.chatId = chatId;
    this.instanceId = `agent-${chatId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    logger.info({ chatId, instanceId: this.instanceId }, '🤖 AgentEngine 实例已创建');
  }

  async run(text: string): Promise<string> {
    const delay = Math.random() * 2000 + 1000;
    const startTime = Date.now();

    logger.debug(
      { chatId: this.chatId, instanceId: this.instanceId, input: text, delay: Math.round(delay) },
      '⏳ AgentEngine 开始处理请求'
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    const duration = Date.now() - startTime;
    const response = `[${this.chatId}] 模拟回复：收到您的消息「${text}」，处理耗时 ${duration}ms`;

    logger.info(
      { chatId: this.chatId, instanceId: this.instanceId, duration },
      '✅ AgentEngine 处理完成'
    );

    return response;
  }

  getChatId(): string {
    return this.chatId;
  }

  getInstanceId(): string {
    return this.instanceId;
  }
}

export class AgentManager {
  private static instance: AgentManager;
  private agents: Map<string, AgentEngine>;

  private constructor() {
    this.agents = new Map();
    logger.info('🏭 AgentManager 单例工厂已初始化');
  }

  static getInstance(): AgentManager {
    if (!AgentManager.instance) {
      AgentManager.instance = new AgentManager();
    }
    return AgentManager.instance;
  }

  getOrCreate(chatId: string): AgentEngine {
    if (!this.agents.has(chatId)) {
      logger.debug({ chatId, totalInstances: this.agents.size + 1 }, '🆕 创建新的 AgentEngine 实例');
      const agent = new AgentEngine(chatId);
      this.agents.set(chatId, agent);
    } else {
      const existingAgent = this.agents.get(chatId)!;
      logger.debug(
        { chatId, instanceId: existingAgent.getInstanceId(), totalInstances: this.agents.size },
        '♻️ 复用已存在的 AgentEngine 实例'
      );
    }

    return this.agents.get(chatId)!;
  }

  getActiveAgentsCount(): number {
    return this.agents.size;
  }

  hasAgent(chatId: string): boolean {
    return this.agents.has(chatId);
  }
}
