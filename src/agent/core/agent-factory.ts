import { logger } from '../../platform/observability/logger';

export class AgentEngine {
  private readonly chatId: string;
  private instanceId: string;

  constructor(chatId: string) {
    this.chatId = chatId;
    this.instanceId = `agent-${chatId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    logger.info({ chatId, instanceId: this.instanceId }, 'AgentEngine instance created');
  }

  async run(text: string): Promise<string> {
    logger.debug(
      { chatId: this.chatId, instanceId: this.instanceId, input: text },
      '⏳ AgentEngine 开始处理请求'
    );

    // TODO: 实现真正的 AI 处理逻辑
    const response = `[${this.chatId}] 处理消息：${text}`;

    logger.info(
      { chatId: this.chatId, instanceId: this.instanceId },
      'AgentEngine 处理完成'
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
    logger.info('AgentManager singleton factory initialized');
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
